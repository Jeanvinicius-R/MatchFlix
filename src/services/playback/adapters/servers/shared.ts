import type { PlaybackType } from "../../playback.types";
import { createSafeFetch } from "../../proxy/safe-fetch";
import {
  fetchJson,
  fetchText,
  type AdapterFailure,
  type FetchTextOptions,
  type JsonResult,
  type ProxiedMedia,
  type ResolvedAsset,
} from "../adapter.types";
import { applyAuth, type ServerAuth } from "./config";

/** Shorthand for the fail-closed answer. */
export function fail(reason: string): AdapterFailure {
  return { reason };
}

export function isFailure(value: unknown): value is AdapterFailure {
  return typeof value === "object" && value !== null && "reason" in value;
}

export interface BrowserMedia {
  type: Extract<PlaybackType, "direct" | "hls" | "dash">;
  mimeType: string;
}

/** What the browser can play by itself, by file extension (no transcoding here). */
const MEDIA_BY_EXTENSION: ReadonlyMap<string, BrowserMedia> = new Map<string, BrowserMedia>([
  ["mp4", { type: "direct", mimeType: "video/mp4" }],
  ["webm", { type: "direct", mimeType: "video/webm" }],
  ["m3u8", { type: "hls", mimeType: "application/vnd.apple.mpegurl" }],
  ["mpd", { type: "dash", mimeType: "application/dash+xml" }],
]);

export function mediaFromExtension(extension: string): BrowserMedia | null {
  return MEDIA_BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

/** Lowercase extension of the URL's path ("mp4"), or "" when there is none. */
export function extensionOfUrl(raw: string): string {
  try {
    const last = new URL(raw).pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");

    return dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  } catch {
    return "";
  }
}

/** The "host[:port]" matcher for fetchJson's redirect check: same host only. */
export function sameHost(url: string): (host: string) => boolean {
  const host = new URL(url).host;

  return (candidate) => candidate === host;
}

/** `https://host:port` of a URL, or null when it is not a valid http(s) URL. */
export function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);

    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The server's own origin first, then the operator's extra media origins, no repeats. */
export function allowedOriginsFor(
  serverUrl: string,
  mediaOrigins: readonly string[],
): string[] {
  const origins: string[] = [];

  for (const candidate of [serverUrl, ...mediaOrigins]) {
    const origin = originOf(candidate);

    if (origin !== null && !origins.includes(origin)) {
      origins.push(origin);
    }
  }

  return origins;
}

/** Whether `url` is an http(s) URL on one of `allowedOrigins`. */
export function isOnAllowedOrigin(url: string, allowedOrigins: readonly string[]): boolean {
  const origin = originOf(url);

  return origin !== null && allowedOrigins.includes(origin);
}

export const OUT_OF_ORIGIN_REASON =
  'A URL do vídeo está fora das origens permitidas do servidor (veja "mediaOrigins").';

/** Proxied media plus the operator's private-network opt-in (carried in the token). */
export type ServerProxiedMedia = ProxiedMedia & { allowPrivateNetwork?: boolean };

/**
 * Describes media the browser must reach through the proxy. DASH is refused
 * (its manifests reference segments in ways the proxy does not rewrite) and so
 * is HLS authenticated by a URL parameter (segment URIs would lose it). The URL
 * must sit on one of `allowedOrigins`; those are also what the proxy may contact.
 */
export function toProxiedMedia(options: {
  url: string;
  auth: ServerAuth;
  media: BrowserMedia;
  allowedOrigins: readonly string[];
  allowPrivateNetwork?: boolean;
  /** Headers on top of the AUTH's (e.g. none today). */
  headers?: Record<string, string>;
}): ServerProxiedMedia | AdapterFailure {
  const { url, auth, media } = options;

  if (media.type === "dash") {
    return fail(
      "DASH não é suportado através do proxy. Use um servidor sem autenticação ou HLS/MP4.",
    );
  }

  if (media.type === "hls" && auth.type === "query") {
    return fail(
      "HLS com autenticação por parâmetro de URL não é suportado; use bearer, header ou basic.",
    );
  }

  if (!isOnAllowedOrigin(url, options.allowedOrigins)) {
    return fail(OUT_OF_ORIGIN_REASON);
  }

  // Userinfo cannot be carried by the proxy token (and would leak in logs).
  try {
    const parsed = new URL(url);

    if (parsed.username !== "" || parsed.password !== "") {
      return fail("URLs com usuário e senha embutidos não são suportadas.");
    }
  } catch {
    return fail("URL do vídeo inválida.");
  }

  const applied = applyAuth(auth, url, options.headers);
  const proxied: ServerProxiedMedia = {
    upstreamUrl: applied.url,
    allowedOrigins: [...options.allowedOrigins],
  };

  if (Object.keys(applied.headers).length > 0) {
    proxied.headers = applied.headers;
  }

  if (options.allowPrivateNetwork === true) {
    proxied.allowPrivateNetwork = true;
  }

  return proxied;
}

/** Why a connection was refused when the address was private (pt-BR, no URL). */
export const PRIVATE_NETWORK_REASON =
  'O endereço do servidor aponta para uma rede privada ou reservada e foi recusado por segurança (se o servidor é seu, defina "allowPrivateNetwork": true na configuração).';

/** Words the safe fetch uses when it refuses an address (never ECONNREFUSED). */
const REFUSAL_PATTERN =
  /privad|private|loopback|link-local|reservad|reserved|bloquead|blocked|metadata|recusad/i;

export interface ProbeOptions {
  signal: AbortSignal;
  /** Names the endpoint in the failure reason ("o servidor Xtream"). */
  what: string;
  headers?: Record<string, string>;
  /** Redirects are only followed (max 3) while they stay on these origins. */
  allowedOrigins: readonly string[];
}

/** The only HTTP calls the server adapters make, behind the safe fetch. */
export interface ServerHttp {
  json<T>(url: string, options: Omit<FetchTextOptions, "accept">): Promise<JsonResult<T>>;
  text(url: string, options: FetchTextOptions): Promise<JsonResult<string>>;
  /** Checks that a media URL really answers (HEAD, then ranged GET). null = reachable. */
  probe(url: string, options: ProbeOptions): Promise<AdapterFailure | null>;
}

export interface ServerHttpOptions {
  /** Tests inject a fake; production uses the safe fetch (no private addresses). */
  fetchImpl?: typeof fetch;
  allowPrivateNetwork: boolean;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const MAX_PROBE_REDIRECTS = 3;

export function createServerHttp(options: ServerHttpOptions): ServerHttp {
  const inner =
    options.fetchImpl ?? createSafeFetch({ allowPrivateNetwork: options.allowPrivateNetwork });
  const refused = new WeakSet<AbortSignal>();

  // Remembers (per request signal) that the safe fetch refused the address, so
  // the generic "falha de rede" can be replaced by the real motivo.
  const guarded = (async (...args: Parameters<typeof fetch>) => {
    try {
      return await inner(...args);
    } catch (error) {
      const signal = args[1]?.signal;

      if (signal && error instanceof Error && REFUSAL_PATTERN.test(error.message)) {
        refused.add(signal);
      }

      throw error;
    }
  }) as typeof fetch;

  function refine<D>(result: JsonResult<D>, signal: AbortSignal): JsonResult<D> {
    if (!result.ok && refused.delete(signal)) {
      return { ok: false, reason: PRIVATE_NETWORK_REASON };
    }

    return result;
  }

  async function attempt(
    method: "HEAD" | "GET",
    url: string,
    probe: ProbeOptions,
  ): Promise<Response | AdapterFailure> {
    try {
      return await guarded(url, {
        method,
        signal: probe.signal,
        redirect: "manual",
        headers: {
          ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
          ...probe.headers,
        },
      });
    } catch {
      if (refused.delete(probe.signal)) {
        return fail(PRIVATE_NETWORK_REASON);
      }

      return fail(
        probe.signal.aborted
          ? `${probe.what} não respondeu a tempo.`
          : `Falha de rede ao consultar ${probe.what}.`,
      );
    }
  }

  async function discard(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
  }

  return {
    async json<T>(url: string, fetchOptions: Omit<FetchTextOptions, "accept">) {
      refused.delete(fetchOptions.signal);
      return refine(await fetchJson<T>(guarded, url, fetchOptions), fetchOptions.signal);
    },

    async text(url: string, fetchOptions: FetchTextOptions) {
      refused.delete(fetchOptions.signal);
      return refine(await fetchText(guarded, url, fetchOptions), fetchOptions.signal);
    },

    async probe(url: string, probe: ProbeOptions) {
      refused.delete(probe.signal);
      let current = url;

      for (let redirects = 0; ; redirects += 1) {
        let response = await attempt("HEAD", current, probe);

        // Servers often mishandle HEAD: a 1-byte ranged GET settles it.
        if (!isFailure(response) && (response.status < 200 || response.status >= 400)) {
          await discard(response);
          response = await attempt("GET", current, probe);
        }

        if (isFailure(response)) {
          return response;
        }

        await discard(response);

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          let next: string | null = null;

          try {
            next = location ? new URL(location, current).toString() : null;
          } catch {
            next = null;
          }

          if (
            next === null ||
            redirects >= MAX_PROBE_REDIRECTS ||
            !isOnAllowedOrigin(next, probe.allowedOrigins)
          ) {
            return fail(`${probe.what} redirecionou para um destino não permitido.`);
          }

          current = next;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          return fail(`${probe.what} respondeu HTTP ${response.status} para o vídeo.`);
        }

        // An HTML page with a 200 is an error page, not a video.
        if ((response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) {
          return fail(`${probe.what} devolveu uma página em vez do vídeo.`);
        }

        return null;
      }
    },
  };
}

/** Where the browser gets the media: a public https URL XOR the proxy. */
export type MediaTarget = { url: string } | { proxy: ServerProxiedMedia };

/**
 * Turns a media target into the adapter's answer, after proving the media
 * really answers (so an association is never "available" just because the
 * provider's catalog lists it). `probe: false` skips the check (tests).
 */
export async function finalizeAsset(options: {
  http: ServerHttp;
  signal: AbortSignal;
  label: string;
  what: string;
  media: BrowserMedia;
  target: MediaTarget;
  /** Origins a probe may follow redirects within. */
  allowedOrigins: readonly string[];
  probe: boolean;
}): Promise<ResolvedAsset | AdapterFailure> {
  const { target, media } = options;

  if (options.probe) {
    const failure = await options.http.probe(
      "proxy" in target ? target.proxy.upstreamUrl : target.url,
      {
        signal: options.signal,
        what: options.what,
        headers: "proxy" in target ? target.proxy.headers : undefined,
        allowedOrigins: options.allowedOrigins,
      },
    );

    if (failure) {
      return failure;
    }
  }

  const base = { type: media.type, mimeType: media.mimeType, label: options.label };

  return "proxy" in target ? { ...base, proxy: target.proxy } : { ...base, url: target.url };
}
