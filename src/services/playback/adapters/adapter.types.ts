import type { PlaybackSource } from "../playback.types";

/**
 * What an adapter learns about one asset of an AUTHORIZED provider. It is the
 * playable part of a PlaybackSource; the provider layer adds id/provider.
 */
export type ResolvedAssetBase = Pick<
  PlaybackSource,
  "type" | "mimeType" | "qualities" | "subtitles" | "attribution" | "label" | "sandbox"
> & {
  /**
   * true = the URL was CONSTRUCTED from identifiers (EMBED providers): at most
   * the page was seen answering, never that the video exists and plays. Such an
   * association stays "unknown" instead of "confirmed" after a check.
   */
  unconfirmed?: boolean;
};

/**
 * Media the BROWSER must never contact directly: the upstream URL carries
 * credentials (Xtream/M3U/private servers) or needs server-side headers. The
 * association provider turns it into a same-origin, encrypted, expiring
 * `/api/playback/proxy/<token>` URL; the proxy route only ever contacts one of
 * `allowedOrigins`. Credentials stay in the backend.
 */
export interface ProxiedMedia {
  /** Absolute https URL on the provider (may embed credentials). Server-side only. */
  upstreamUrl: string;
  /** Extra request headers (e.g. Authorization) added by the proxy. Server-side only. */
  headers?: Record<string, string>;
  /** Exact origins ("https://host[:port]") the proxy may contact for this asset. */
  allowedOrigins: string[];
  /**
   * The operator explicitly declared this server lives on a private network
   * (PLAYBACK_SERVERS "allowPrivateNetwork": true). Only then may the proxy
   * connect to private/loopback addresses. Default false.
   */
  allowPrivateNetwork?: boolean;
}

/**
 * What an adapter learns about one asset: either a public https `url` the
 * browser can fetch itself, or a `proxy` description (never both).
 */
export type ResolvedAsset =
  | (ResolvedAssetBase & { url: string; proxy?: undefined })
  | (ResolvedAssetBase & { url?: undefined; proxy: ProxiedMedia });

/** What the sync asks a provider about: one TMDB title/episode. */
export interface DiscoveryQuery {
  tmdbId: number;
  /** "tt1234567" when TMDB knows it (external_ids). */
  imdbId?: string;
  mediaType: "MOVIE" | "EPISODE";
  seasonNumber: number;
  episodeNumber: number;
  /** pt-BR title (series name for an episode). */
  title: string;
  originalTitle?: string;
  year?: number;
  runtimeMinutes?: number;
}

/** A provider item that MAY be the requested title. A suggestion, never proof. */
export interface ProviderCandidate {
  providerAssetId: string;
  title: string;
  year?: number;
  durationMinutes?: number;
  /** Identifiers the provider itself declares (the strongest evidence). */
  externalIds?: { tmdb?: number; imdb?: string };
}

/** One entry of a provider's own catalog (Xtream/M3U/REST listings). */
export interface ProviderCatalogItem extends ProviderCandidate {
  mediaType: "MOVIE" | "EPISODE";
  /** Episodes only; `externalIds.tmdb` then refers to the SERIES. */
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface CatalogPage {
  items: ProviderCatalogItem[];
  /** Opaque cursor for the next page; absent on the last page. */
  nextCursor?: string;
}

/** Fail-closed answer: the asset is not playable (or not provably allowed). */
export interface AdapterFailure {
  /** Short, human-readable motivo (pt-BR) shown to the admin. */
  reason: string;
}

export interface AdapterResolveOptions {
  signal: AbortSignal;
  /**
   * "verify" = an admin/cron availability check: adapters may spend a network
   * round-trip to confirm the asset. Absent/"play" = a viewer is waiting, keep
   * it cheap.
   */
  purpose?: "play" | "verify";
}

export interface DeriveAssetIdInput {
  tmdbId: number;
  /** TMDB external_ids of the movie (or of the SERIES for an episode). */
  imdbId?: string;
  mediaType: "MOVIE" | "EPISODE";
  seasonNumber: number;
  episodeNumber: number;
}

export interface AdapterDescriptor {
  /** "embed", "xtream", "m3u", "files", "rest". */
  kind: string;
  /** false = switched off in the configuration: nothing is offered to viewers. */
  enabled: boolean;
  /** Short lines for the admin ("Origem: https://…", "Filme: /embed/movie/{tmdbId}"). */
  details: string[];
}

/**
 * One adapter per remote provider. It receives the provider-specific asset id
 * stored in a PlaybackAssociation, talks to the provider's PUBLIC API only, and
 * answers either with a playable asset or with the reason it refuses. Adapters
 * decide the technical gate (license, privacy, availability); the administrative
 * decision (rightsStatus) lives in the association and is checked by the provider.
 */
export interface PlaybackAdapter {
  id: string;
  label: string;
  /** Format hint shown in the admin form. */
  assetIdHint: string;
  /**
   * Provider-level proof of authorization (contract / license of the whole
   * catalog), set for servers the operator configured. It only PRE-FILLS the
   * admin's batch approval; it never grants rights by itself.
   */
  licenseReference?: string;
  /**
   * Operator-declared private-network server (see ProxiedMedia). Informational
   * for the admin UI; the proxy decision itself travels in the proxy token.
   */
  allowPrivateNetwork?: boolean;
  /**
   * Secret-free description for the admin screen (kind, on/off, where it
   * points). Only set by configured servers.
   */
  descriptor?: AdapterDescriptor;
  /**
   * Optional: providers whose ids ARE the TMDB/IMDb ids (EMBED) can derive the
   * asset id from the title instead of the admin typing it. Never from a name:
   * `imdbId` must come from TMDB's external_ids endpoint.
   */
  deriveAssetId?(input: DeriveAssetIdInput): string | AdapterFailure;
  /** True when deriveAssetId needs the IMDb id (the caller then asks TMDB for it). */
  requiresImdbId?: boolean;
  resolve(
    assetId: string,
    options: AdapterResolveOptions,
  ): Promise<ResolvedAsset | AdapterFailure>;

  /**
   * Optional: search the provider for items that may be this TMDB title.
   * Searches by external ids first (reliable), then by metadata. Results are
   * only SUGGESTIONS stored as PlaybackCandidate; nothing becomes playable
   * without an administrator approving it with a license reference.
   */
  discover?(
    query: DiscoveryQuery,
    options: AdapterResolveOptions,
  ): Promise<ProviderCandidate[] | AdapterFailure>;

  /** Optional: page through the provider's own catalog (Xtream/M3U/REST). */
  listCatalog?(
    cursor: string | undefined,
    options: AdapterResolveOptions,
  ): Promise<CatalogPage | AdapterFailure>;
}

export function isAdapterFailure(
  result: ResolvedAsset | AdapterFailure,
): result is AdapterFailure {
  return "reason" in result;
}

/** Descriptive User-Agent, required by archive.org for automated requests. */
export const ADAPTER_USER_AGENT =
  "MatchFlix/1.0 (+https://github.com/Jeanvinicius-R/MatchFlix)";

/** The runtime's fetch, looked up at call time (so stubbing globalThis.fetch still works). */
export const defaultFetch = ((...args: Parameters<typeof fetch>) =>
  fetch(...args)) as typeof fetch;

/** https URL without embedded credentials — the only kind adapters may return. */
export function isCleanHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export type JsonResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Largest metadata document an adapter reads (the timeout alone does not bound it). */
export const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** Redirects followed by hand, each one checked against `allowedHost`. */
const MAX_REDIRECTS = 3;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** The https target of a redirect when its host is allowed, else null. */
function resolveRedirect(
  from: string,
  location: string | null,
  allowedHost?: (host: string) => boolean,
): string | null {
  if (!location || !allowedHost) {
    return null;
  }

  try {
    const target = new URL(location, from);

    return target.protocol === "https:" &&
      target.username === "" &&
      target.password === "" &&
      allowedHost(target.host)
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}

/** Body as text, or null when it is larger than `maxBytes` (never buffers past it). */
export async function readTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) {
    return null;
  }

  if (!response.body) {
    const text = await response.text();
    return text.length > maxBytes ? null : text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return text + decoder.decode();
    }

    received += value.byteLength;

    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }

    text += decoder.decode(value, { stream: true });
  }
}

export interface FetchTextOptions {
  signal: AbortSignal;
  /** Names the endpoint in the failure reason ("metadata do Internet Archive"). */
  what: string;
  allowedHost?: (host: string) => boolean;
  /** Extra request headers (e.g. Authorization). Never put in a reason or a log. */
  headers?: Record<string, string>;
  /** Body cap in bytes; defaults to MAX_JSON_BYTES. */
  maxBytes?: number;
  /** Accept header; defaults to JSON. */
  accept?: string;
}

/**
 * GET + JSON with the failure modes folded into a reason: an adapter never
 * throws because the remote side is slow, down or answers garbage.
 * `what` names the endpoint in the reason ("metadata do Internet Archive").
 * Redirects are never followed blindly: one is only taken when `allowedHost`
 * (given the "host[:port]") accepts its https target, at most MAX_REDIRECTS times.
 * The body is capped at MAX_JSON_BYTES (or `maxBytes`).
 */
export async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: Omit<FetchTextOptions, "accept">,
): Promise<JsonResult<T>> {
  const result = await fetchText(fetchImpl, url, options);

  if (!result.ok) {
    return result;
  }

  try {
    return { ok: true, data: JSON.parse(result.data) as T };
  } catch {
    return { ok: false, reason: `${options.what} devolveu uma resposta inválida.` };
  }
}

/** Same as fetchJson but the body stays text (M3U playlists). */
export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  options: FetchTextOptions,
): Promise<JsonResult<string>> {
  let currentUrl = url;

  for (let redirects = 0; ; redirects += 1) {
    let response: Response;

    try {
      response = await fetchImpl(currentUrl, {
        signal: options.signal,
        redirect: "manual",
        headers: {
          Accept: options.accept ?? "application/json",
          "User-Agent": ADAPTER_USER_AGENT,
          ...options.headers,
        },
      });
    } catch {
      return {
        ok: false,
        reason: options.signal.aborted
          ? `${options.what} não respondeu a tempo.`
          : `Falha de rede ao consultar ${options.what}.`,
      };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const next =
        redirects < MAX_REDIRECTS
          ? resolveRedirect(
              currentUrl,
              response.headers.get("location"),
              options.allowedHost,
            )
          : null;

      if (next === null) {
        return {
          ok: false,
          reason: `${options.what} redirecionou para um destino não permitido.`,
        };
      }

      currentUrl = next;
      continue;
    }

    if (!response.ok) {
      return { ok: false, reason: `${options.what} respondeu HTTP ${response.status}.` };
    }

    try {
      const text = await readTextWithLimit(response, options.maxBytes ?? MAX_JSON_BYTES);

      if (text === null) {
        return { ok: false, reason: `${options.what} devolveu uma resposta grande demais.` };
      }

      return { ok: true, data: text };
    } catch {
      return { ok: false, reason: `${options.what} devolveu uma resposta inválida.` };
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `parent[key]` when it is a plain object, else an empty record (never throws). */
export function readRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = parent[key];
  return isRecord(value) ? value : {};
}
