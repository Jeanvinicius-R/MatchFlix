import { ADAPTER_USER_AGENT, defaultFetch } from "../adapters/adapter.types";
import { hasHlsExtension, isHlsContentType, rewriteHlsManifest } from "./hls-rewrite";
import {
  buildProxyUrl,
  mintProxyToken,
  readProxyToken,
  type ProxyTokenPayload,
} from "./proxy-token";

/**
 * Core of GET/HEAD /api/playback/proxy/<token>, free of next/auth/prisma so it
 * can be tested with a fake fetch. The route only adds the session check and
 * the per-user stream limit.
 *
 * The proxy is NOT an open proxy: the only URL it ever fetches is the one
 * inside an encrypted token minted for the same user, and every hop (including
 * redirects and HLS child URIs) must stay within the token's allowedOrigins.
 * Credentials live in the token and in upstream requests, never in a response.
 */

export interface ProxyRequest {
  method: string;
  token: string;
  rangeHeader?: string | null;
  ifRangeHeader?: string | null;
  /** The signed-in user; must be the user the token was minted for. */
  viewerId?: string;
  fetchImpl?: typeof fetch;
  /** Fires when the client goes away: the upstream request is aborted. */
  signal?: AbortSignal;
  now?: number;
  secret?: string;
}

export interface ProxyResult {
  status: number;
  /** Lower-case names, safe to send to the browser as they are. */
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | string | null;
}

/** Playlists are tiny; a larger "manifest" is something else (or hostile). */
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 20_000;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** The only upstream response headers the browser ever sees. */
const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/octet-stream",
  "application/mp4",
  "text/vtt",
]);

const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const GENERIC_UPSTREAM_ERROR = "Fonte de mídia indisponível.";

function baseHeaders(): Record<string, string> {
  return {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
}

function fail(
  status: number,
  message: string,
  extra: Record<string, string> = {},
): ProxyResult {
  return {
    status,
    headers: { ...baseHeaders(), "content-type": "text/plain; charset=utf-8", ...extra },
    body: message,
  };
}

function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

function isAllowedMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("video/") ||
    mediaType.startsWith("audio/") ||
    ALLOWED_MEDIA_TYPES.has(mediaType)
  );
}

/** http(s), no userinfo, and an origin the token covers. */
function isAllowedUrl(url: URL, allowedOrigins: ReadonlySet<string>): boolean {
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.username === "" &&
    url.password === "" &&
    allowedOrigins.has(url.origin)
  );
}

/** A single "bytes=a-b" range; anything else is ignored (the full body is served). */
function sanitizeRange(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return /^bytes=\d{0,15}-\d{0,15}$/.test(trimmed) && trimmed !== "bytes=-" ? trimmed : null;
}

/** An entity tag or HTTP date: printable ASCII only. */
function sanitizeIfRange(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "" || trimmed.length > 200) {
    return null;
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);

    if (code < 0x20 || code > 0x7e) {
      return null;
    }
  }

  return trimmed;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to clean up if the body is already gone.
  }
}

/** Body as text, or null when it is larger than `maxBytes` (never buffers past it). */
async function readTextWithLimit(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
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

type UpstreamResult =
  | { ok: true; response: Response; finalUrl: URL }
  | { ok: false; result: ProxyResult };

/**
 * GETs/HEADs the upstream, following at most MAX_REDIRECTS redirects by hand.
 * Every hop must stay inside `allowedOrigins`; the server-side headers (auth)
 * are dropped for good once a redirect leaves the origin that received them.
 */
async function fetchUpstream(
  fetchImpl: typeof fetch,
  method: "GET" | "HEAD",
  start: URL,
  serverHeaders: Record<string, string>,
  rangeHeaders: Record<string, string>,
  allowedOrigins: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<UpstreamResult> {
  let url = start;
  let sendServerHeaders = true;

  for (let redirects = 0; ; redirects += 1) {
    if (!isAllowedUrl(url, allowedOrigins)) {
      return { ok: false, result: fail(502, GENERIC_UPSTREAM_ERROR) };
    }

    const headers = new Headers({
      Accept: "*/*",
      "Accept-Encoding": "identity",
      "User-Agent": ADAPTER_USER_AGENT,
    });

    if (sendServerHeaders) {
      for (const [name, value] of Object.entries(serverHeaders)) {
        headers.set(name, value);
      }
    }

    for (const [name, value] of Object.entries(rangeHeaders)) {
      headers.set(name, value);
    }

    let response: Response;

    try {
      response = await fetchImpl(url.href, { method, headers, redirect: "manual", signal });
    } catch {
      return { ok: false, result: fail(502, GENERIC_UPSTREAM_ERROR) };
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: true, response, finalUrl: url };
    }

    await discard(response);

    let next: URL | null = null;
    const location = response.headers.get("location");

    if (location && redirects < MAX_REDIRECTS) {
      try {
        next = new URL(location, url);
      } catch {
        next = null;
      }
    }

    if (next === null || !isAllowedUrl(next, allowedOrigins)) {
      return { ok: false, result: fail(502, GENERIC_UPSTREAM_ERROR) };
    }

    if (next.origin !== url.origin) {
      sendServerHeaders = false;
    }

    url = next;
  }
}

export async function handleProxyRequest(request: ProxyRequest): Promise<ProxyResult> {
  const method = request.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return fail(405, "Método não permitido.", { allow: "GET, HEAD" });
  }

  if (!request.viewerId) {
    return fail(401, "Acesso restrito.");
  }

  const tokenOptions = { now: request.now, secret: request.secret };
  const payload = readProxyToken(request.token, tokenOptions);

  if (!payload) {
    return fail(404, "Link de mídia inválido ou expirado.");
  }

  if (payload.userId !== request.viewerId) {
    return fail(403, "Acesso negado.");
  }

  if (request.signal?.aborted) {
    return fail(502, GENERIC_UPSTREAM_ERROR);
  }

  const allowedOrigins: ReadonlySet<string> = new Set(payload.allowedOrigins);
  const start = new URL(payload.upstreamUrl);
  const looksLikeManifest = hasHlsExtension(start);

  // A partial playlist cannot be rewritten: never ask for a range of one.
  const rangeHeaders: Record<string, string> = {};
  const range = looksLikeManifest ? null : sanitizeRange(request.rangeHeader);

  if (range !== null) {
    rangeHeaders.Range = range;
    const ifRange = sanitizeIfRange(request.ifRangeHeader);

    if (ifRange !== null) {
      rangeHeaders["If-Range"] = ifRange;
    }
  }

  // One controller for the whole exchange: client gone, or upstream too slow.
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, UPSTREAM_TIMEOUT_MS);
  let streaming = false;

  try {
    const upstream = await fetchUpstream(
      request.fetchImpl ?? defaultFetch,
      method,
      start,
      payload.headers,
      rangeHeaders,
      allowedOrigins,
      controller.signal,
    );

    if (!upstream.ok) {
      return upstream.result;
    }

    const { response, finalUrl } = upstream;
    const { status } = response;

    if (status === 404) {
      await discard(response);
      return fail(404, "Conteúdo não encontrado.");
    }

    if (status === 416) {
      await discard(response);
      const contentRange = response.headers.get("content-range");

      return {
        status: 416,
        headers: contentRange
          ? { ...baseHeaders(), "content-range": contentRange }
          : baseHeaders(),
        body: null,
      };
    }

    if (status !== 200 && status !== 206) {
      await discard(response);
      return fail(502, GENERIC_UPSTREAM_ERROR);
    }

    const contentType = response.headers.get("content-type");
    const mediaType = mediaTypeOf(contentType) || "application/octet-stream";

    if (!isAllowedMediaType(mediaType)) {
      await discard(response);
      return fail(502, GENERIC_UPSTREAM_ERROR);
    }

    if (isHlsContentType(contentType) || hasHlsExtension(finalUrl)) {
      if (status !== 200) {
        await discard(response);
        return fail(502, GENERIC_UPSTREAM_ERROR);
      }

      if (method === "HEAD") {
        await discard(response);
        return { status: 200, headers: manifestHeaders(), body: null };
      }

      return await rewriteManifest(response, finalUrl, payload, request);
    }

    const headers = baseHeaders();

    for (const name of FORWARDED_HEADERS) {
      const value = response.headers.get(name);

      if (value !== null) {
        headers[name] = value;
      }
    }

    headers["content-type"] = contentType ?? mediaType;

    // A decoded body no longer matches the length the origin announced.
    const encoding = response.headers.get("content-encoding");

    if (encoding && encoding.trim().toLowerCase() !== "identity") {
      delete headers["content-length"];
    }

    if (method === "HEAD" || !response.body) {
      await discard(response);
      return { status, headers, body: null };
    }

    // The stream outlives this call: the abort listener stays until it ends.
    streaming = true;
    return { status, headers, body: response.body };
  } catch {
    return fail(502, GENERIC_UPSTREAM_ERROR);
  } finally {
    clearTimeout(timer);

    if (!streaming) {
      request.signal?.removeEventListener("abort", abort);
    }
  }
}

function manifestHeaders(): Record<string, string> {
  return {
    ...baseHeaders(),
    "content-type": `${HLS_CONTENT_TYPE}; charset=utf-8`,
  };
}

async function rewriteManifest(
  response: Response,
  manifestUrl: URL,
  payload: ProxyTokenPayload,
  request: ProxyRequest,
): Promise<ProxyResult> {
  const text = await readTextWithLimit(response, MAX_MANIFEST_BYTES);

  if (text === null) {
    return fail(502, GENERIC_UPSTREAM_ERROR);
  }

  const upstreamOrigin = new URL(payload.upstreamUrl).origin;
  const rewritten = rewriteHlsManifest(text, {
    baseUrl: manifestUrl.href,
    allowedOrigins: payload.allowedOrigins,
    rewriteUrl(absoluteUrl) {
      // Auth headers only follow children that live on the origin they were minted for.
      const sameOrigin = new URL(absoluteUrl).origin === upstreamOrigin;

      return buildProxyUrl(
        mintProxyToken(
          {
            upstreamUrl: absoluteUrl,
            headers: sameOrigin ? payload.headers : {},
            allowedOrigins: payload.allowedOrigins,
            userId: payload.userId,
          },
          { now: request.now, secret: request.secret },
        ),
      );
    },
  });

  if (!rewritten.ok) {
    return fail(502, GENERIC_UPSTREAM_ERROR);
  }

  return { status: 200, headers: manifestHeaders(), body: rewritten.manifest };
}

/**
 * Passes `body` through and calls `onEnd` exactly once when it finishes, fails
 * or is cancelled by the client (used to release the per-user stream slot).
 */
export function onStreamEnd(
  body: ReadableStream<Uint8Array>,
  onEnd: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let ended = false;

  const finish = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          finish();
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();

      try {
        await reader.cancel(reason);
      } catch {
        // The upstream is already closed.
      }
    },
  });
}
