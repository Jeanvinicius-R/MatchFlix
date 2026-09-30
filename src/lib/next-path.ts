import type { NextRequest } from "next/server";

/**
 * The public origin a request came in through, for building an absolute
 * redirect URL in a Route Handler (`NextResponse.redirect` needs one).
 *
 * `request.url`'s origin is *not* safe for this behind a reverse proxy
 * (Docker + the Cloudflare tunnel, in production): Next's standalone server
 * only sees the proxy's internal connection, so it falls back to its own
 * bind address — e.g. "https://0.0.0.0:3000" — instead of the public host,
 * sending the browser to an address only reachable from inside the
 * container. `x-forwarded-*` (set by any standard reverse proxy, including
 * cloudflared) carries the real one; the raw `host` header and finally
 * `request.url` cover direct/local access, where there is no proxy to set it.
 */
export function getRequestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    return request.nextUrl.origin;
  }
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

/**
 * Where to go after login / profile selection. Only same-site absolute paths are
 * accepted, so a crafted ?next= can never bounce the user to another site.
 */
export function safeNextPath(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }
  return value;
}

/** "/profiles" or "/login" plus the destination, when there is one. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
