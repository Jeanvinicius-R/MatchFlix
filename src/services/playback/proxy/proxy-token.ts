import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Opaque, encrypted, expiring capability for `/api/playback/proxy/<token>`.
 *
 * The token carries everything the proxy needs (upstream URL, server-side
 * headers, the origins it may contact, the user it was minted for) so no state
 * is stored anywhere. It is AES-256-GCM encrypted: the browser can neither read
 * the upstream URL/credentials nor forge or alter a token. The key is derived
 * from AUTH_SECRET with a purpose label, so it is never the session key itself.
 *
 * Layout (base64url): iv (12 bytes) | ciphertext | auth tag (16 bytes).
 * Plaintext: {"v":1,"u":url,"h":headers,"o":origins,"uid":userId,"e":expiry}
 * with `e` in epoch SECONDS.
 */

export interface ProxyTokenInput {
  /** Absolute http(s) URL, may embed credentials in path/query (never userinfo). */
  upstreamUrl: string;
  /** Extra request headers (e.g. Authorization). Server-side only. */
  headers?: Record<string, string>;
  /** Exact origins ("https://host[:port]") the proxy may contact. */
  allowedOrigins: string[];
  /** The only user who may use the token. */
  userId: string;
}

export interface ProxyTokenPayload {
  upstreamUrl: string;
  headers: Record<string, string>;
  /** Normalized origins (as `URL.origin` writes them). */
  allowedOrigins: string[];
  userId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface ProxyTokenOptions {
  /** Epoch milliseconds; defaults to Date.now(). */
  now?: number;
  /** Defaults to AUTH_SECRET. */
  secret?: string;
}

export interface MintProxyTokenOptions extends ProxyTokenOptions {
  /** Defaults to PLAYBACK_PROXY_TTL_SECONDS or 6 h. */
  ttlSeconds?: number;
}

export const PROXY_PATH_PREFIX = "/api/playback/proxy/";

export const DEFAULT_PROXY_TTL_SECONDS = 6 * 60 * 60;
const MIN_ENV_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 12 * 60 * 60;

/** Keeps the whole proxy path well below the 4096-char limit of the source guard. */
const MAX_TOKEN_LENGTH = 4000;

const TOKEN_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_LABEL = "matchflix/playback-proxy/v1";
const AAD = Buffer.from("matchflix-playback-proxy-v1", "utf8");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_HEADER_VALUE_LENGTH = 2048;
const MAX_HEADERS = 8;
const MAX_ORIGINS = 8;

/** TTL from PLAYBACK_PROXY_TTL_SECONDS (300..43200), else the 6 h default. */
export function resolveProxyTtlSeconds(
  raw: string | undefined = process.env.PLAYBACK_PROXY_TTL_SECONDS,
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_PROXY_TTL_SECONDS;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value >= MIN_ENV_TTL_SECONDS && value <= MAX_TTL_SECONDS
    ? value
    : DEFAULT_PROXY_TTL_SECONDS;
}

function resolveSecret(secret: string | undefined): string {
  const value = secret ?? process.env.AUTH_SECRET;

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("AUTH_SECRET ausente: o proxy de mídia não pode assinar tokens.");
  }

  return value;
}

function deriveKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

/** "https://host:8443" for an http(s) URL without userinfo, else null. */
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname === ""
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

/** No control characters (CR/LF would split headers) and a sane length. */
function isSafeHeaderValue(value: string): boolean {
  if (value.length > MAX_HEADER_VALUE_LENGTH) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return true;
}

function sanitizeHeaders(headers: unknown): Record<string, string> | null {
  if (headers === undefined) {
    return {};
  }

  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    return null;
  }

  const entries = Object.entries(headers as Record<string, unknown>);

  if (entries.length > MAX_HEADERS) {
    return null;
  }

  const result: Record<string, string> = {};

  for (const [name, value] of entries) {
    if (
      !HEADER_NAME_PATTERN.test(name) ||
      typeof value !== "string" ||
      !isSafeHeaderValue(value)
    ) {
      return null;
    }

    result[name] = value;
  }

  return result;
}

function sanitizeOrigins(origins: unknown): string[] | null {
  if (!Array.isArray(origins) || origins.length === 0 || origins.length > MAX_ORIGINS) {
    return null;
  }

  const result: string[] = [];

  for (const item of origins) {
    const origin = normalizeOrigin(item);

    if (origin === null) {
      return null;
    }

    if (!result.includes(origin)) {
      result.push(origin);
    }
  }

  return result;
}

/** Throws (with a message that never contains the URL) when the input is unusable. */
function validateInput(input: ProxyTokenInput) {
  const origin = normalizeOrigin(input.upstreamUrl);
  const allowedOrigins = sanitizeOrigins(input.allowedOrigins);
  const headers = sanitizeHeaders(input.headers);

  if (origin === null) {
    throw new Error("upstreamUrl inválida para o proxy de mídia.");
  }

  if (allowedOrigins === null) {
    throw new Error("allowedOrigins inválidas para o proxy de mídia.");
  }

  if (!allowedOrigins.includes(origin)) {
    throw new Error("upstreamUrl fora das allowedOrigins do proxy de mídia.");
  }

  if (headers === null) {
    throw new Error("headers inválidos para o proxy de mídia.");
  }

  if (typeof input.userId !== "string" || input.userId === "") {
    throw new Error("userId obrigatório para o proxy de mídia.");
  }

  return { allowedOrigins, headers };
}

/** Encrypts `input` into a URL-safe token. Throws without a secret or on bad input. */
export function mintProxyToken(
  input: ProxyTokenInput,
  options: MintProxyTokenOptions = {},
): string {
  const key = deriveKey(resolveSecret(options.secret));
  const { allowedOrigins, headers } = validateInput(input);
  const ttlSeconds = options.ttlSeconds ?? resolveProxyTtlSeconds();

  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error("ttlSeconds inválido para o proxy de mídia.");
  }

  const now = options.now ?? Date.now();
  const plaintext = JSON.stringify({
    v: TOKEN_VERSION,
    u: input.upstreamUrl,
    h: headers,
    o: allowedOrigins,
    uid: input.userId,
    e: Math.floor(now / 1000) + ttlSeconds,
  });

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const token = Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");

  if (token.length > MAX_TOKEN_LENGTH) {
    throw new Error("Token do proxy de mídia grande demais.");
  }

  return token;
}

/** The payload of a valid, unexpired token, or null for ANY other input. */
export function readProxyToken(
  token: string,
  options: ProxyTokenOptions = {},
): ProxyTokenPayload | null {
  try {
    if (
      typeof token !== "string" ||
      token.length < 16 ||
      token.length > MAX_TOKEN_LENGTH ||
      !TOKEN_PATTERN.test(token)
    ) {
      return null;
    }

    const raw = Buffer.from(token, "base64url");

    // Reject non-canonical encodings so a token has exactly one valid spelling.
    if (raw.length <= IV_BYTES + TAG_BYTES || raw.toString("base64url") !== token) {
      return null;
    }

    const key = deriveKey(resolveSecret(options.secret));
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const encrypted = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
    const data: unknown = JSON.parse(plaintext);

    if (typeof data !== "object" || data === null) {
      return null;
    }

    const record = data as Record<string, unknown>;

    if (
      record.v !== TOKEN_VERSION ||
      typeof record.u !== "string" ||
      typeof record.uid !== "string" ||
      record.uid === "" ||
      typeof record.e !== "number" ||
      !Number.isFinite(record.e)
    ) {
      return null;
    }

    const expiresAt = record.e * 1000;

    if ((options.now ?? Date.now()) >= expiresAt) {
      return null;
    }

    const headers = sanitizeHeaders(record.h);
    const allowedOrigins = sanitizeOrigins(record.o);

    if (headers === null || allowedOrigins === null) {
      return null;
    }

    const origin = normalizeOrigin(record.u);

    if (origin === null || !allowedOrigins.includes(origin)) {
      return null;
    }

    return {
      upstreamUrl: record.u,
      headers,
      allowedOrigins,
      userId: record.uid,
      expiresAt,
    };
  } catch {
    // Wrong secret, tampering, bad JSON, missing secret: all look the same.
    return null;
  }
}

/** Same-origin URL the browser uses for a token. */
export function buildProxyUrl(token: string): string {
  return `${PROXY_PATH_PREFIX}${token}`;
}
