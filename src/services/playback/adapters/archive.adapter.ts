import type { PlaybackAttribution } from "../playback.types";
import {
  defaultFetch,
  fetchJson,
  isRecord,
  readRecord,
  type AdapterFailure,
  type DiscoveryQuery,
  type PlaybackAdapter,
  type ProviderCandidate,
  type ResolvedAsset,
} from "./adapter.types";

/**
 * Internet Archive adapter. Being on archive.org proves nothing about rights
 * (the "feature_films" collection is open to uploads, and licenseurl/rights are
 * typed by the uploader), so the gate is strict and fail-closed:
 *
 *   - mediatype "movies", not dark, not lending/restricted;
 *   - a licenseurl inside an explicit allowlist (CC0, Public Domain Mark, the
 *     legacy publicdomain URLs, CC BY and CC BY-SA, any version);
 *   - no licenseurl, or any other license (-nc, -nd, unknown) => refused.
 *
 * The playable file is picked from the item's own file list (name/format),
 * never built from a guessed name, and the browser streams it straight from
 * archive.org (no proxy).
 */

const ARCHIVE_BASE_URL = "https://archive.org";

/** archive.org or one of its subdomains (data servers): the only redirects followed. */
function isArchiveHost(host: string): boolean {
  return host === "archive.org" || host.endsWith(".archive.org");
}

/** Archive identifiers are ASCII slugs. Anything else never reaches a URL. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Not the film itself: samples, thumbnails, previews, trailers. */
const EXCLUDED_FILE_PATTERN = /sample|thumb|preview|trailer/i;

/** Collections that mean "borrow-only" or print-disabled access. */
const RESTRICTED_COLLECTION_PATTERN = /lending|inlibrary|printdisabled/i;

/**
 * Maps a licenseurl to a readable license, or null when it is not on the
 * allowlist. Only creativecommons.org URLs are understood; "-nc" and "-nd"
 * variants never match.
 */
export function parseAllowedLicense(raw: string): string | null {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  // The picker never writes credentials or a port; an odd host:port is not it.
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (host !== "creativecommons.org" && host !== "www.creativecommons.org") {
    return null;
  }

  const path = url.pathname.toLowerCase().replace(/\/+$/, "");

  if (path === "/publicdomain/mark/1.0") {
    return "Domínio público (PDM 1.0)";
  }

  if (path === "/publicdomain/zero/1.0") {
    return "CC0 1.0";
  }

  // Legacy URLs older items still carry.
  if (path === "/publicdomain" || path === "/licenses/publicdomain") {
    return "Domínio público";
  }

  // by / by-sa, any version, optional jurisdiction ("/3.0/us").
  const match = /^\/licenses\/(by|by-sa)\/(\d+\.\d+)(?:\/([a-z]{2,3}))?$/.exec(path);

  if (!match) {
    return null;
  }

  const name = match[1] === "by" ? "CC BY" : "CC BY-SA";
  const jurisdiction = match[3] ? ` ${match[3].toUpperCase()}` : "";

  return `${name} ${match[2]}${jurisdiction}`;
}

interface Candidate {
  name: string;
  formatRank: number;
  isDerivative: boolean;
  size: number;
}

/** H.264 first, then MPEG4 containers; anything else is not a web video. */
function formatRank(format: unknown): number {
  if (typeof format !== "string") {
    return 0;
  }

  const normalized = format.trim().toLowerCase();

  if (/^h\.?264/.test(normalized)) {
    return 2;
  }

  return /mpeg-?4/.test(normalized) ? 1 : 0;
}

function isSafeFileName(name: string): boolean {
  return name
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Picks the MP4 to stream from the item's file list: H.264 before MPEG4,
 * archive-made derivatives before the uploaded original, then the largest.
 * Returns the file name exactly as listed, or null when nothing is playable.
 */
export function pickVideoFile(files: readonly unknown[]): string | null {
  const candidates: Candidate[] = [];

  for (const file of files) {
    if (!isRecord(file)) {
      continue;
    }

    const name = file.name;

    if (typeof name !== "string") {
      continue;
    }

    const rank = formatRank(file.format);

    if (
      rank === 0 ||
      !/\.(mp4|m4v)$/i.test(name) ||
      EXCLUDED_FILE_PATTERN.test(name) ||
      !isSafeFileName(name)
    ) {
      continue;
    }

    candidates.push({
      name,
      formatRank: rank,
      isDerivative: file.source === "derivative",
      size: Number(file.size) || 0,
    });
  }

  candidates.sort(
    (a, b) =>
      b.formatRank - a.formatRank ||
      Number(b.isDerivative) - Number(a.isDerivative) ||
      b.size - a.size ||
      a.name.localeCompare(b.name),
  );

  return candidates[0]?.name ?? null;
}

function toStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

/** Why the item is off limits, or null when it is open to anyone. */
function findRestriction(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string | null {
  if (isTruthyFlag(data.is_dark) || isTruthyFlag(metadata.is_dark)) {
    return "O item está indisponível (dark) no Internet Archive.";
  }

  if (isTruthyFlag(metadata["access-restricted-item"])) {
    return "O item tem acesso restrito no Internet Archive.";
  }

  if (
    toStringList(metadata.collection).some((name) => RESTRICTED_COLLECTION_PATTERN.test(name))
  ) {
    return "O item é de empréstimo ou de acesso restrito no Internet Archive.";
  }

  return null;
}


/** Rows asked from advancedsearch: enough for a title, small enough to stay polite. */
const DISCOVER_ROWS = 15;
const MAX_DISCOVER_RESULTS = 8;

/** Fields the search asks for; "date" is the fallback for a missing "year". */
const DISCOVER_FIELDS = ["identifier", "title", "year", "date", "licenseurl", "runtime"];

/** Text safe to place between quotes of a Lucene phrase query. */
function toPhrase(title: string): string {
  return title
    .replace(/["\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** "01:29:55", "9:56", "596.5" or "596" (seconds) -> minutes, else undefined. */
function parseRuntimeMinutes(value: unknown): number | undefined {
  const raw = toStringList(value)[0]?.trim();

  if (!raw) {
    return undefined;
  }

  let seconds: number;

  if (raw.includes(":")) {
    const parts = raw.split(":").map(Number);

    if (
      parts.length > 3 ||
      parts.some((part) => !Number.isFinite(part) || part < 0)
    ) {
      return undefined;
    }

    seconds = parts.reduce((total, part) => total * 60 + part, 0);
  } else {
    seconds = Number(raw);
  }

  return Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : undefined;
}

function parseYear(...values: unknown[]): number | undefined {
  for (const value of values) {
    const match = /^\s*(\d{4})/.exec(toStringList(value)[0] ?? "");
    const year = match ? Number(match[1]) : NaN;

    if (year >= 1850 && year <= 2200) {
      return year;
    }
  }

  return undefined;
}

/**
 * Turns one advancedsearch document into a suggestion, or null when it is not an
 * openly licensed movie. Only a SUGGESTION: resolve() re-checks the full gate.
 * Archive items declare no TMDB/IMDb id we trust (the field is free text typed by
 * the uploader), so the matcher can only score them by title + year (+ runtime).
 */
function toDiscoveredCandidate(doc: unknown): ProviderCandidate | null {
  if (!isRecord(doc)) {
    return null;
  }

  const identifier = typeof doc.identifier === "string" ? doc.identifier.trim() : "";
  const title = toStringList(doc.title)[0]?.trim() ?? "";
  const licenseUrl = typeof doc.licenseurl === "string" ? doc.licenseurl : "";

  if (!IDENTIFIER_PATTERN.test(identifier) || title === "" || !parseAllowedLicense(licenseUrl)) {
    return null;
  }

  const candidate: ProviderCandidate = {
    providerAssetId: identifier,
    title: title.slice(0, 300),
  };
  const year = parseYear(doc.year, doc.date);
  const minutes = parseRuntimeMinutes(doc.runtime);

  if (year !== undefined) {
    candidate.year = year;
  }

  if (minutes !== undefined) {
    candidate.durationMinutes = minutes;
  }

  return candidate;
}

export interface ArchiveAdapterOptions {
  fetchImpl?: typeof fetch;
}

export function createArchiveAdapter(options: ArchiveAdapterOptions = {}): PlaybackAdapter {
  const fetchImpl = options.fetchImpl ?? defaultFetch;

  return {
    id: "archive",
    label: "Internet Archive",
    assetIdHint:
      'Identificador do item, a parte final de archive.org/details/<identificador> (ex.: "BigBuckBunny_124").',

    /**
     * Title search (advancedsearch). Episodes are not supported: the Archive has
     * no episode-level metadata we could match, so EPISODE queries return [].
     * Only items whose licenseurl is on the allowlist are suggested.
     */
    async discover(
      query: DiscoveryQuery,
      { signal },
    ): Promise<ProviderCandidate[] | AdapterFailure> {
      if (query.mediaType !== "MOVIE") {
        return [];
      }

      const phrases = Array.from(
        new Set(
          [query.title, query.originalTitle]
            .map((title) => toPhrase(title ?? ""))
            .filter((phrase) => phrase !== ""),
        ),
      );

      if (phrases.length === 0) {
        return [];
      }

      const titleClause = phrases.map((phrase) => `title:("${phrase}")`).join(" OR ");
      const params = new URLSearchParams();

      params.set("q", `(${titleClause}) AND mediatype:movies`);

      for (const field of DISCOVER_FIELDS) {
        params.append("fl[]", field);
      }

      params.set("rows", String(DISCOVER_ROWS));
      params.set("output", "json");

      const result = await fetchJson<unknown>(
        fetchImpl,
        `${ARCHIVE_BASE_URL}/advancedsearch.php?${params.toString()}`,
        { signal, what: "a busca do Internet Archive", allowedHost: isArchiveHost },
      );

      if (!result.ok) {
        return { reason: result.reason };
      }

      const body = result.data;
      const docs = isRecord(body) ? readRecord(body, "response").docs : undefined;

      if (!Array.isArray(docs)) {
        return { reason: "A busca do Internet Archive devolveu uma resposta inválida." };
      }

      const candidates: ProviderCandidate[] = [];
      const seen = new Set<string>();

      for (const doc of docs as unknown[]) {
        const candidate = toDiscoveredCandidate(doc);

        if (candidate && !seen.has(candidate.providerAssetId)) {
          seen.add(candidate.providerAssetId);
          candidates.push(candidate);
        }

        if (candidates.length >= MAX_DISCOVER_RESULTS) {
          break;
        }
      }

      return candidates;
    },

    async resolve(assetId, { signal }): Promise<ResolvedAsset | AdapterFailure> {
      const identifier = assetId.trim();

      if (!IDENTIFIER_PATTERN.test(identifier)) {
        return { reason: "Identificador do Internet Archive inválido." };
      }

      const result = await fetchJson<unknown>(
        fetchImpl,
        `${ARCHIVE_BASE_URL}/metadata/${encodeURIComponent(identifier)}`,
        { signal, what: "o Internet Archive", allowedHost: isArchiveHost },
      );

      if (!result.ok) {
        return { reason: result.reason };
      }

      const data = result.data;
      const metadata = isRecord(data) ? data.metadata : undefined;

      // A missing item comes back as [] or {}.
      if (!isRecord(data) || !isRecord(metadata)) {
        return { reason: "Item não encontrado no Internet Archive." };
      }

      const restriction = findRestriction(data, metadata);

      if (restriction) {
        return { reason: restriction };
      }

      if (metadata.mediatype !== "movies") {
        return { reason: 'O item não é do tipo "movies" no Internet Archive.' };
      }

      // Fail-closed: no licenseurl (even with a "rights" text) means no source.
      const licenseUrl = typeof metadata.licenseurl === "string" ? metadata.licenseurl : "";

      if (licenseUrl.trim() === "") {
        return { reason: "O item não declara licença (licenseurl) no Internet Archive." };
      }

      const license = parseAllowedLicense(licenseUrl);

      if (!license) {
        return {
          reason: `Licença fora da lista permitida (${licenseUrl.trim().slice(0, 120)}).`,
        };
      }

      const fileName = pickVideoFile(Array.isArray(data.files) ? data.files : []);

      if (!fileName) {
        return { reason: "O item não tem um vídeo MP4 (H.264) reproduzível no navegador." };
      }

      const attribution: PlaybackAttribution = {
        license,
        sourceUrl: `${ARCHIVE_BASE_URL}/details/${encodeURIComponent(identifier)}`,
      };
      const author = toStringList(metadata.creator).join(", ").slice(0, 200);

      if (author !== "") {
        attribution.author = author;
      }

      return {
        type: "direct",
        url: `${ARCHIVE_BASE_URL}/download/${encodeURIComponent(identifier)}/${fileName
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        mimeType: "video/mp4",
        label: "Internet Archive",
        attribution,
      };
    },
  };
}
