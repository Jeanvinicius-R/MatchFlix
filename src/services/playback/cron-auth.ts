import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Authorization of the internal cron endpoint (POST /api/internal/reverify):
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time. Pure (no
 * Next.js, no env access) so it can be tested.
 */

/** Both sides are hashed first, so the comparison never depends on their lengths. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function readBearerToken(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match ? match[1] : null;
}

/** False when the secret is empty (the endpoint is disabled), or the token does not match. */
export function isAuthorizedCronRequest(
  header: string | null | undefined,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected) {
    return false;
  }
  const token = readBearerToken(header);
  if (token === null) {
    return false;
  }
  return timingSafeEqual(digest(token), digest(expected));
}
