import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, isIPv4, isIPv6 } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

/**
 * A fetch that cannot be aimed at the operator's own network (SSRF).
 *
 * Why not plain fetch: the hostname is resolved by the runtime, so a name may
 * point at 127.0.0.1, a cloud metadata address or a LAN host, and a DNS answer
 * can change between a check and the connection (rebinding). Here the name is
 * resolved ONCE, EVERY returned address must be public, and the socket is
 * opened against the validated IP itself (Host header and TLS servername keep
 * the original name). Redirects are never followed blindly: manual mode returns
 * the 3xx untouched, follow mode re-validates every hop (max 3) and drops all
 * non-trivial request headers when the origin changes.
 *
 * The only exception is `allowPrivateNetwork: true`, set explicitly by the
 * operator for a server that really lives on a private network.
 */

export type LookupFn = (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>;

export type SafeFetchErrorCode =
  | "BLOCKED_ADDRESS"
  | "DNS_FAILED"
  | "INVALID_URL"
  | "TOO_MANY_REDIRECTS"
  | "UNSUPPORTED";

/** Refusal raised BEFORE any connection; the message is safe to show (no URL, no secrets). */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export interface SafeFetchOptions {
  /** Operator-declared private-network server. Default false. */
  allowPrivateNetwork?: boolean;
  /** Resolves ALL addresses of a host (injectable for tests). */
  lookup?: LookupFn;
}

const MAX_REDIRECTS = 3;
/** Time to get the response HEADERS (connect + TLS + first byte); streaming is not capped. */
const HEADERS_TIMEOUT_MS = 20_000;
/** Addresses tried in order when a connection fails before any response. */
const MAX_ADDRESS_ATTEMPTS = 4;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
/** Statuses whose Response must not carry a body. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/** Headers that survive a redirect to another origin (never credentials). */
const CROSS_ORIGIN_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "user-agent",
  "range",
  "if-range",
]);

/** Set by the transport itself; a caller-provided value would be wrong or hostile. */
const TRANSPORT_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "te",
  "keep-alive",
  "proxy-connection",
]);

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

/** [network, prefix length] of every IPv4 block that is not public Internet. */
const BLOCKED_IPV4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes the 169.254.169.254 metadata service
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];

  for (const part of parts) {
    // Leading zeros are ambiguous (octal in some parsers): fail closed.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }

    const value = Number(part);

    if (value > 255) {
      return null;
    }

    octets.push(value);
  }

  return octets;
}

function ipv4ToNumber(octets: readonly number[]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

const BLOCKED_IPV4_RANGES = BLOCKED_IPV4.map(([network, prefix]) => {
  const base = ipv4ToNumber(parseIPv4(network) ?? [0, 0, 0, 0]);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return { base: (base & mask) >>> 0, mask };
});

function isBlockedIPv4Octets(octets: readonly number[]): boolean {
  const value = ipv4ToNumber(octets);

  return BLOCKED_IPV4_RANGES.some((range) => ((value & range.mask) >>> 0) === range.base);
}

/** The eight 16-bit groups of an IPv6 address, or null when it is malformed. */
function parseIPv6(input: string): number[] | null {
  let text = input;
  const zone = text.indexOf("%");

  if (zone !== -1) {
    text = text.slice(0, zone);
  }

  if (!isIPv6(text)) {
    return null;
  }

  // Fold an embedded dotted IPv4 ("::ffff:1.2.3.4") into two hex groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);

  if (tail.includes(".")) {
    const octets = parseIPv4(tail);

    if (octets === null) {
      return null;
    }

    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");

  if (halves.length > 2) {
    return null;
  }

  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  let groups: string[];

  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;

    if (missing < 1) {
      return null;
    }

    groups = [...head, ...new Array<string>(missing).fill("0"), ...rest];
  } else {
    groups = head;
  }

  if (groups.length !== 8) {
    return null;
  }

  const values: number[] = [];

  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }

    values.push(parseInt(group, 16));
  }

  return values;
}

function octetsOfGroups(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isBlockedIPv6(address: string): boolean {
  const g = parseIPv6(address);

  if (g === null) {
    return true;
  }

  const firstFiveZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;

  // ::ffff:a.b.c.d is an IPv4 address in disguise: judge it as IPv4.
  if (firstFiveZero && g[5] === 0xffff) {
    return isBlockedIPv4Octets(octetsOfGroups(g[6], g[7]));
  }

  // 64:ff9b::/96 (NAT64) carries an IPv4 address; 64:ff9b:1::/48 is local-use.
  // Checked before ::/8 because its first group (0x0064) also falls inside it.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return isBlockedIPv4Octets(octetsOfGroups(g[6], g[7]));
    }

    return true;
  }

  // ::/8 — unspecified (::), loopback (::1), IPv4-compatible and the rest of it.
  if (g[0] >> 8 === 0) {
    return true;
  }

  // 2002::/16 (6to4) embeds the IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) {
    return isBlockedIPv4Octets(octetsOfGroups(g[1], g[2]));
  }

  // 2001::/32 Teredo and 2001:db8::/32 documentation.
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) {
    return true;
  }

  // 100::/64 discard-only.
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) {
    return true;
  }

  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (g[0] & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/**
 * True for every address that is not reachable public unicast: private,
 * loopback, link-local, CGNAT, multicast, reserved, metadata, IPv4-mapped
 * IPv6 of those, and anything that is not a valid IP literal (fail closed).
 */
export function isBlockedAddress(address: string): boolean {
  if (typeof address !== "string") {
    return true;
  }

  if (isIPv4(address)) {
    const octets = parseIPv4(address);

    return octets === null || isBlockedIPv4Octets(octets);
  }

  if (address.includes(":")) {
    return isBlockedIPv6(address);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

async function defaultLookup(hostname: string) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });

  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? (6 as const) : (4 as const),
  }));
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Every address a connection to `hostname` may use. Throws SafeFetchError when
 * the name does not resolve or when ANY of its addresses is not allowed (one
 * public record next to a private one is still a refusal: the runtime could
 * pick either).
 */
export async function resolveSafeAddresses(
  hostname: string,
  options: SafeFetchOptions = {},
): Promise<ResolvedAddress[]> {
  const allowPrivate = options.allowPrivateNetwork === true;
  const host =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  const literalFamily = isIP(host);

  if (literalFamily !== 0) {
    if (!allowPrivate && isBlockedAddress(host)) {
      throw new SafeFetchError(
        "BLOCKED_ADDRESS",
        "Destino recusado: endereço de rede privado ou reservado.",
      );
    }

    return [{ address: host, family: literalFamily === 6 ? 6 : 4 }];
  }

  let records: Awaited<ReturnType<LookupFn>>;

  try {
    records = await (options.lookup ?? defaultLookup)(host);
  } catch {
    throw new SafeFetchError("DNS_FAILED", `Não foi possível resolver o host "${host}".`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new SafeFetchError("DNS_FAILED", `Não foi possível resolver o host "${host}".`);
  }

  const result: ResolvedAddress[] = [];

  for (const record of records) {
    const family = isIP(record?.address ?? "");

    if (family === 0 || (!allowPrivate && isBlockedAddress(record.address))) {
      throw new SafeFetchError(
        "BLOCKED_ADDRESS",
        `Destino recusado: "${host}" resolve para um endereço de rede privado ou reservado.`,
      );
    }

    if (!result.some((item) => item.address === record.address)) {
      result.push({ address: record.address, family: family === 6 ? 6 : 4 });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

/** One request against ONE validated address. Rejects on transport errors. */
function requestOnce(
  url: URL,
  target: ResolvedAddress,
  method: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const secure = url.protocol === "https:";
    const hostIsLiteral = isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0;
    const request = (secure ? https : http).request(
      {
        host: target.address,
        family: target.family,
        port: url.port !== "" ? Number(url.port) : secure ? 443 : 80,
        method,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host },
        // SNI and certificate checks use the NAME, the socket uses the IP.
        ...(secure && !hostIsLiteral ? { servername: url.hostname } : {}),
        agent: false,
        signal,
      },
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
    );

    const timer = setTimeout(() => {
      request.destroy(new Error("Tempo esgotado ao aguardar a resposta."));
    }, HEADERS_TIMEOUT_MS);

    request.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

function toWebHeaders(source: IncomingMessage["headers"]): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, item);
      } catch {
        // A header the Fetch API refuses is not worth failing the response for.
      }
    }
  }

  return headers;
}

function decoderFor(encoding: string) {
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return null;
  }
}

/** Wraps the Node response in a web Response (decoding content-encoding like fetch does). */
function toResponse(message: IncomingMessage, method: string): Response {
  const status = message.statusCode ?? 502;
  const headers = toWebHeaders(message.headers);

  if (method === "HEAD" || NULL_BODY_STATUSES.has(status)) {
    message.destroy();
    return new Response(null, { status, statusText: message.statusMessage, headers });
  }

  let stream: Readable = message;
  const encoding = (headers.get("content-encoding") ?? "").trim().toLowerCase();

  if (encoding !== "" && encoding !== "identity") {
    const decoder = decoderFor(encoding);

    if (decoder === null) {
      message.destroy();
      throw new SafeFetchError("UNSUPPORTED", "Codificação de conteúdo não suportada.");
    }

    stream = pipeline(message, decoder, () => undefined);
    // The announced length and encoding no longer describe the decoded bytes.
    headers.delete("content-encoding");
    headers.delete("content-length");
  }

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
    status,
    statusText: message.statusMessage,
    headers,
  });
}

function toRequestHeaders(source: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  source.forEach((value, name) => {
    const lower = name.toLowerCase();

    if (!TRANSPORT_HEADERS.has(lower)) {
      result[lower] = value;
    }
  });

  return result;
}

function parseTarget(input: string | URL | Request): URL {
  let url: URL;

  try {
    url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    throw new SafeFetchError("INVALID_URL", "URL inválida.");
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new SafeFetchError("INVALID_URL", "Só são permitidas URLs http(s) sem credenciais.");
  }

  return url;
}

/**
 * Builds the SSRF-safe fetch. GET/HEAD style requests only: a request body is
 * rejected. `init.redirect`: "manual" returns the 3xx as is, "error" rejects,
 * "follow" (the fetch default) follows at most 3 hops, each one re-resolved and
 * re-validated.
 */
export function createSafeFetch(options: SafeFetchOptions = {}): typeof fetch {
  const resolveOptions: SafeFetchOptions = {
    allowPrivateNetwork: options.allowPrivateNetwork === true,
    lookup: options.lookup,
  };

  return async function safeFetchImpl(input, init) {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    if (init?.body !== undefined && init.body !== null) {
      throw new SafeFetchError("UNSUPPORTED", "Requisições com corpo não são suportadas.");
    }

    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const redirectMode = init?.redirect ?? "follow";
    const headers = new Headers(input instanceof Request ? input.headers : undefined);

    if (init?.headers !== undefined) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }

    let url = parseTarget(input);
    let requestHeaders = toRequestHeaders(headers);

    for (let hop = 0; ; hop += 1) {
      if (signal?.aborted) {
        throw abortReason(signal);
      }

      const addresses = await resolveSafeAddresses(url.hostname, resolveOptions);
      let message: IncomingMessage | null = null;
      let lastError: unknown = null;

      for (const target of addresses.slice(0, MAX_ADDRESS_ATTEMPTS)) {
        try {
          message = await requestOnce(url, target, method, requestHeaders, signal);
          break;
        } catch (error) {
          if (signal?.aborted) {
            throw abortReason(signal);
          }

          lastError = error;
        }
      }

      if (message === null) {
        // Same shape as the runtime's own network failure; no URL in the message.
        throw new TypeError("fetch failed", { cause: lastError });
      }

      const status = message.statusCode ?? 0;
      const location = message.headers.location;

      if (!REDIRECT_STATUSES.has(status) || typeof location !== "string") {
        return toResponse(message, method);
      }

      if (redirectMode === "manual") {
        return toResponse(message, method);
      }

      message.destroy();

      if (redirectMode === "error") {
        throw new TypeError("fetch failed", { cause: new Error("redirect") });
      }

      if (hop >= MAX_REDIRECTS) {
        throw new SafeFetchError("TOO_MANY_REDIRECTS", "Redirecionamentos demais.");
      }

      let next: URL;

      try {
        next = parseTarget(new URL(location, url));
      } catch {
        throw new SafeFetchError("INVALID_URL", "Redirecionamento para um destino inválido.");
      }

      if (next.origin !== url.origin) {
        // Credentials (Authorization, API keys, cookies) never follow to another origin.
        requestHeaders = Object.fromEntries(
          Object.entries(requestHeaders).filter(([name]) => CROSS_ORIGIN_HEADERS.has(name)),
        );
      }

      url = next;
    }
  };
}

/** Default instance: public network only. */
export const safeFetch: typeof fetch = createSafeFetch();
