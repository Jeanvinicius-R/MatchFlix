import type { PlaybackSource } from "../playback.types";

/**
 * What an adapter learns about one asset of an AUTHORIZED provider. It is the
 * playable part of a PlaybackSource; the provider layer adds id/provider.
 */
export type ResolvedAsset = Pick<
  PlaybackSource,
  "type" | "url" | "mimeType" | "qualities" | "subtitles" | "attribution" | "label"
>;

/** Fail-closed answer: the asset is not playable (or not provably allowed). */
export interface AdapterFailure {
  /** Short, human-readable motivo (pt-BR) shown to the admin. */
  reason: string;
}

export interface AdapterResolveOptions {
  signal: AbortSignal;
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
  resolve(
    assetId: string,
    options: AdapterResolveOptions,
  ): Promise<ResolvedAsset | AdapterFailure>;
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
async function readTextWithLimit(response: Response, maxBytes: number): Promise<string | null> {
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

/**
 * GET + JSON with the failure modes folded into a reason: an adapter never
 * throws because the remote side is slow, down or answers garbage.
 * `what` names the endpoint in the reason ("metadata do Internet Archive").
 * Redirects are never followed blindly: one is only taken when `allowedHost`
 * (given the "host[:port]") accepts its https target, at most MAX_REDIRECTS times.
 * The body is capped at MAX_JSON_BYTES.
 */
export async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: { signal: AbortSignal; what: string; allowedHost?: (host: string) => boolean },
): Promise<JsonResult<T>> {
  let currentUrl = url;

  for (let redirects = 0; ; redirects += 1) {
    let response: Response;

    try {
      response = await fetchImpl(currentUrl, {
        signal: options.signal,
        redirect: "manual",
        headers: { Accept: "application/json", "User-Agent": ADAPTER_USER_AGENT },
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
      const text = await readTextWithLimit(response, MAX_JSON_BYTES);

      if (text === null) {
        return { ok: false, reason: `${options.what} devolveu uma resposta grande demais.` };
      }

      return { ok: true, data: JSON.parse(text) as T };
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
