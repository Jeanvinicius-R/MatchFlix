import type {
  PlaybackAttribution,
  PlaybackQuality,
  PlaybackSubtitle,
} from "../playback.types";
import {
  defaultFetch,
  fetchJson,
  isCleanHttpsUrl,
  isRecord,
  readRecord,
  type AdapterFailure,
  type DiscoveryQuery,
  type PlaybackAdapter,
  type ProviderCandidate,
  type ResolvedAsset,
} from "./adapter.types";

/**
 * PeerTube adapter (public REST API, no login). A video is only used when the
 * instance is on the administrator's allowlist (PEERTUBE_ALLOWED_INSTANCES) and
 * the video itself passes a strict, fail-closed gate:
 *
 *   - privacy "Public" (1), state "Published" (1), not a live;
 *   - licence 1 (CC BY), 2 (CC BY-SA), 3 (CC BY-ND), 7 (public domain) or
 *     8 (free of known restrictions). 4-6 (non-commercial), 9 (all rights
 *     reserved) and a missing licence are refused.
 *
 * The licence is declared by the uploader, so this is a technical filter; the
 * administrative decision stays in PlaybackAssociation.rightsStatus.
 *
 * Media and subtitle URLs are taken as returned by the API but must be https AND
 * point to an allowlisted host: the licence and rights decision was made for the
 * allowlist, so a federated video served by another origin (or object storage on
 * its own host) fails closed unless that host is added to PEERTUBE_ALLOWED_INSTANCES.
 * API redirects are only followed within the same instance.
 */

export const PEERTUBE_ALLOWED_LICENCE_IDS: ReadonlySet<number> = new Set([1, 2, 3, 7, 8]);

/** Largest MP4 rendition offered; the HLS playlist adapts by itself. */
const MAX_MP4_HEIGHT = 1080;

const MAX_SUBTITLES = 20;

/** UUID, shortUUID or numeric id. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Hostname with a dot (no "localhost"), optional port. IP literals are refused below. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;
const IP_LITERAL_PATTERN = /^[\d.]+(:\d+)?$/;

/** "https://Tube.Example.org/path" or "tube.example.org" -> "tube.example.org", else null. */
function normalizeHost(raw: string): string | null {
  const value = raw.trim().toLowerCase();

  if (value === "") {
    return null;
  }

  let host = value;

  if (value.includes("://")) {
    try {
      const url = new URL(value);

      if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
        return null;
      }

      host = url.host;
    } catch {
      return null;
    }
  }

  return HOST_PATTERN.test(host) && !IP_LITERAL_PATTERN.test(host) ? host : null;
}

/**
 * Parses PEERTUBE_ALLOWED_INSTANCES: comma-separated hosts ("framatube.org,
 * video.blender.org"). Blanks and malformed entries are dropped. Empty set =
 * adapter off, no request is ever made.
 */
export function parsePeerTubeInstances(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normalizeHost)
      .filter((host): host is string => host !== null),
  );
}

/** "<host>/<uuid-or-shortUUID>" -> parts, or null when malformed. */
export function parsePeerTubeAssetId(assetId: string): { host: string; videoId: string } | null {
  const trimmed = assetId.trim();
  const slash = trimmed.indexOf("/");

  if (slash <= 0) {
    return null;
  }

  const host = normalizeHost(trimmed.slice(0, slash));
  const videoId = trimmed.slice(slash + 1);

  if (host === null || !VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return { host, videoId };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Why the video may not be shown, or null when it passes the gate. */
function findGateProblem(video: Record<string, unknown>): string | null {
  const privacy = readNumber(readRecord(video, "privacy").id);
  const state = readNumber(readRecord(video, "state").id);
  const licence = readNumber(readRecord(video, "licence").id);

  if (privacy !== 1) {
    return "O vídeo do PeerTube não é público.";
  }

  if (state !== 1) {
    return "O vídeo do PeerTube ainda não está publicado.";
  }

  // Strict: a missing flag is not "false".
  if (video.isLive !== false) {
    return "Transmissões ao vivo do PeerTube não são suportadas.";
  }

  if (licence === undefined || !PEERTUBE_ALLOWED_LICENCE_IDS.has(licence)) {
    return "A licença do vídeo do PeerTube não está na lista permitida.";
  }

  return null;
}

/** The URL's host[:port] is on the allowlist (media is only taken from trusted hosts). */
function isAllowedMediaUrl(url: string, allowed: ReadonlySet<string>): boolean {
  try {
    return allowed.has(new URL(url).host);
  } catch {
    return false;
  }
}

/** Progressive MP4 renditions with a picture, up to MAX_MP4_HEIGHT, best first. */
function collectMp4Qualities(
  video: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): PlaybackQuality[] {
  if (!Array.isArray(video.files)) {
    return [];
  }

  const qualities: PlaybackQuality[] = [];

  for (const file of video.files as unknown[]) {
    if (!isRecord(file) || file.hasVideo === false) {
      continue;
    }

    const url = file.fileUrl;

    // Older versions have no "height": the resolution id is the height in pixels.
    const height =
      readNumber(file.height) ?? readNumber(readRecord(file, "resolution").id);

    if (
      !isCleanHttpsUrl(url) ||
      !isAllowedMediaUrl(url, allowed) ||
      height === undefined ||
      height <= 0 ||
      height > MAX_MP4_HEIGHT
    ) {
      continue;
    }

    qualities.push({ label: `${height}p`, height, url });
  }

  return qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

function findHlsPlaylist(
  video: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  if (!Array.isArray(video.streamingPlaylists)) {
    return null;
  }

  for (const playlist of video.streamingPlaylists as unknown[]) {
    // type 1 = HLS
    if (!isRecord(playlist) || playlist.type !== 1) {
      continue;
    }

    const url = playlist.playlistUrl;

    if (isCleanHttpsUrl(url) && isAllowedMediaUrl(url, allowed)) {
      return url;
    }
  }

  return null;
}

/**
 * Only WebVTT, only https, only allowlisted hosts; "fileUrl" (>= 7.1) before the
 * deprecated "captionPath".
 */
function toSubtitleUrl(
  host: string,
  entry: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  for (const raw of [entry.fileUrl, entry.captionPath]) {
    if (typeof raw !== "string") {
      continue;
    }

    try {
      const url = new URL(raw, `https://${host}`);

      if (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        allowed.has(url.host) &&
        url.pathname.toLowerCase().endsWith(".vtt")
      ) {
        return url.toString();
      }
    } catch {
      // Not a URL: try the next field.
    }
  }

  return null;
}

async function fetchSubtitles(
  fetchImpl: typeof fetch,
  host: string,
  videoId: string,
  signal: AbortSignal,
  allowed: ReadonlySet<string>,
): Promise<PlaybackSubtitle[]> {
  const result = await fetchJson<unknown>(
    fetchImpl,
    `https://${host}/api/v1/videos/${videoId}/captions`,
    { signal, what: "as legendas do PeerTube", allowedHost: (target) => target === host },
  );

  // Subtitles are optional: a failure here never blocks the video.
  if (!result.ok) {
    return [];
  }

  const body = result.data;

  if (!isRecord(body) || !Array.isArray(body.data)) {
    return [];
  }

  const subtitles: PlaybackSubtitle[] = [];

  for (const entry of body.data as unknown[]) {
    if (!isRecord(entry)) {
      continue;
    }

    const languageInfo = readRecord(entry, "language");
    const language = readString(languageInfo.id);
    const url = toSubtitleUrl(host, entry, allowed);

    if (!language || !url) {
      continue;
    }

    subtitles.push({
      language,
      label: readString(languageInfo.label) ?? language,
      url,
    });

    if (subtitles.length >= MAX_SUBTITLES) {
      break;
    }
  }

  return subtitles;
}

/** Instances searched per sync (the allowlist is small; this bounds a misconfiguration). */
const MAX_DISCOVER_INSTANCES = 5;
const DISCOVER_COUNT = 10;
const MAX_DISCOVER_RESULTS = 12;
/** A film shorter than this share of TMDB's runtime is probably a clip or a trailer. */
const DISCOVER_MIN_RUNTIME_PERCENT = 70;

/** "(2008)" in a title: PeerTube has no film year, uploaders often write it. */
const TITLE_YEAR_PATTERN = /[([]\s*((?:19|20)\d{2})\s*[)\]]/;

function yearOfDate(value: unknown): number | undefined {
  const text = readString(value);
  const year = text ? Number(text.slice(0, 4)) : NaN;

  return Number.isInteger(year) && year >= 1850 && year <= 2200 ? year : undefined;
}

/**
 * One search hit as a suggestion, or null when it is not a local, non-live video
 * under an allowed licence. The year is the ORIGINAL publication date or a year
 * tagged in the title; the upload date says nothing about the film, so it is not used.
 */
function toDiscoveredCandidate(host: string, hit: unknown): ProviderCandidate | null {
  if (!isRecord(hit)) {
    return null;
  }

  const uuid = readString(hit.uuid);
  const title = readString(hit.name);
  const licence = readNumber(readRecord(hit, "licence").id);

  if (
    !uuid ||
    !VIDEO_ID_PATTERN.test(uuid) ||
    !title ||
    hit.isLive === true ||
    hit.isLocal === false ||
    licence === undefined ||
    !PEERTUBE_ALLOWED_LICENCE_IDS.has(licence)
  ) {
    return null;
  }

  const candidate: ProviderCandidate = {
    providerAssetId: `${host}/${uuid}`,
    title: title.slice(0, 300),
  };
  const titleYear = TITLE_YEAR_PATTERN.exec(title);
  const year =
    yearOfDate(hit.originallyPublishedAt) ?? (titleYear ? Number(titleYear[1]) : undefined);
  const seconds = readNumber(hit.duration);

  if (year !== undefined) {
    candidate.year = year;
  }

  if (seconds !== undefined && seconds > 0) {
    candidate.durationMinutes = seconds / 60;
  }

  return candidate;
}

/** One instance's search for one phrase; failures become a reason, never a throw. */
async function searchInstance(
  fetchImpl: typeof fetch,
  host: string,
  phrase: string,
  minSeconds: number | undefined,
  signal: AbortSignal,
): Promise<{ ok: true; items: ProviderCandidate[] } | { ok: false; reason: string }> {
  const params = new URLSearchParams();

  params.set("search", phrase);
  params.set("searchTarget", "local");
  params.set("isLive", "false");
  params.set("isLocal", "true");
  params.set("count", String(DISCOVER_COUNT));

  // PeerTube reads a list as a repeated parameter, not as a comma-separated value.
  for (const id of PEERTUBE_ALLOWED_LICENCE_IDS) {
    params.append("licenceOneOf", String(id));
  }

  if (minSeconds !== undefined) {
    params.set("durationMin", String(minSeconds));
  }

  const result = await fetchJson<unknown>(
    fetchImpl,
    `https://${host}/api/v1/search/videos?${params.toString()}`,
    { signal, what: `a busca do PeerTube (${host})`, allowedHost: (target) => target === host },
  );

  if (!result.ok) {
    return result;
  }

  const body = result.data;

  if (!isRecord(body) || !Array.isArray(body.data)) {
    return { ok: false, reason: `A busca do PeerTube (${host}) devolveu uma resposta inválida.` };
  }

  const items: ProviderCandidate[] = [];

  for (const hit of body.data as unknown[]) {
    const candidate = toDiscoveredCandidate(host, hit);

    if (candidate) {
      items.push(candidate);
    }
  }

  return { ok: true, items };
}

export interface PeerTubeAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Hosts ("framatube.org") the administrator trusts. Empty/omitted = adapter off. */
  allowedInstances?: Iterable<string>;
}

export function createPeerTubeAdapter(options: PeerTubeAdapterOptions = {}): PlaybackAdapter {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const allowed: ReadonlySet<string> = new Set(
    Array.from(options.allowedInstances ?? [])
      .map(normalizeHost)
      .filter((host): host is string => host !== null),
  );

  return {
    id: "peertube",
    label: "PeerTube",
    assetIdHint:
      'Instância e vídeo: "<host>/<uuid>" (ex.: "framatube.org/f56ae219-f076-4faf-a7f2-ba8b29d1cc5f"). A instância precisa estar em PEERTUBE_ALLOWED_INSTANCES.',

    /**
     * Searches every allowlisted instance (licence filter + minimum duration done
     * by PeerTube itself, re-checked here). Episodes are not supported: PeerTube
     * videos carry no season/episode metadata to match against, so EPISODE
     * queries return []. Results are suggestions; resolve() keeps the full gate.
     */
    async discover(
      query: DiscoveryQuery,
      { signal },
    ): Promise<ProviderCandidate[] | AdapterFailure> {
      if (allowed.size === 0) {
        return { reason: "PeerTube desativado (PEERTUBE_ALLOWED_INSTANCES está vazio)." };
      }

      if (query.mediaType !== "MOVIE") {
        return [];
      }

      const phrases = Array.from(
        new Set(
          [query.title, query.originalTitle]
            .map((title) => (title ?? "").replace(/\s+/g, " ").trim().slice(0, 120))
            .filter((phrase) => phrase !== ""),
        ),
      );

      if (phrases.length === 0) {
        return [];
      }

      const runtimeMinutes = query.runtimeMinutes;
      const minSeconds =
        typeof runtimeMinutes === "number" && Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
          ? Math.floor((runtimeMinutes * 60 * DISCOVER_MIN_RUNTIME_PERCENT) / 100)
          : undefined;
      const hosts = Array.from(allowed).slice(0, MAX_DISCOVER_INSTANCES);
      const searches = hosts.flatMap((host) =>
        phrases.map((phrase) => searchInstance(fetchImpl, host, phrase, minSeconds, signal)),
      );
      const outcomes = await Promise.all(searches);
      const candidates: ProviderCandidate[] = [];
      const seen = new Set<string>();
      let firstFailure: string | undefined;

      for (const outcome of outcomes) {
        if (!outcome.ok) {
          firstFailure ??= outcome.reason;
          continue;
        }

        for (const item of outcome.items) {
          if (!seen.has(item.providerAssetId)) {
            seen.add(item.providerAssetId);
            candidates.push(item);
          }
        }
      }

      // Every search failed: say so instead of pretending the provider has nothing.
      if (candidates.length === 0 && firstFailure !== undefined && outcomes.every((o) => !o.ok)) {
        return { reason: firstFailure };
      }

      return candidates.slice(0, MAX_DISCOVER_RESULTS);
    },

    async resolve(assetId, { signal }): Promise<ResolvedAsset | AdapterFailure> {
      if (allowed.size === 0) {
        return { reason: "PeerTube desativado (PEERTUBE_ALLOWED_INSTANCES está vazio)." };
      }

      const parsed = parsePeerTubeAssetId(assetId);

      if (!parsed) {
        return { reason: 'Identificador do PeerTube inválido (use "<host>/<uuid>").' };
      }

      const { host, videoId } = parsed;

      if (!allowed.has(host)) {
        return { reason: `A instância "${host}" não está em PEERTUBE_ALLOWED_INSTANCES.` };
      }

      const result = await fetchJson<unknown>(
        fetchImpl,
        `https://${host}/api/v1/videos/${videoId}`,
        {
          signal,
          what: `o PeerTube (${host})`,
          allowedHost: (target) => target === host,
        },
      );

      if (!result.ok) {
        return { reason: result.reason };
      }

      const video = result.data;

      if (!isRecord(video)) {
        return { reason: "O PeerTube devolveu uma resposta inválida." };
      }

      const problem = findGateProblem(video);

      if (problem) {
        return { reason: problem };
      }

      const hlsUrl = findHlsPlaylist(video, allowed);
      const qualities = hlsUrl ? [] : collectMp4Qualities(video, allowed);

      if (!hlsUrl && qualities.length === 0) {
        return {
          reason:
            "O vídeo do PeerTube não tem HLS nem MP4 (até 1080p) em https numa instância permitida.",
        };
      }

      const licence = readRecord(video, "licence");
      const account = readRecord(video, "account");
      const channel = readRecord(video, "channel");
      const pageId = readString(video.shortUUID) ?? readString(video.uuid) ?? videoId;
      const attribution: PlaybackAttribution = {
        sourceUrl: `https://${host}/w/${encodeURIComponent(pageId)}`,
      };
      const licenseLabel = readString(licence.label);
      const author = readString(account.displayName) ?? readString(channel.displayName);

      if (licenseLabel) {
        attribution.license = licenseLabel;
      }

      if (author) {
        attribution.author = author;
      }

      const subtitles = await fetchSubtitles(fetchImpl, host, videoId, signal, allowed);
      const asset: ResolvedAsset = hlsUrl
        ? { type: "hls", url: hlsUrl, mimeType: "application/vnd.apple.mpegurl" }
        : { type: "direct", url: qualities[0].url, mimeType: "video/mp4", qualities };

      asset.label = "PeerTube";
      asset.attribution = attribution;

      if (subtitles.length > 0) {
        asset.subtitles = subtitles;
      }

      return asset;
    },
  };
}
