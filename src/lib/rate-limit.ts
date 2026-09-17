/**
 * Minimal in-memory fixed-window rate limiter — enough to slow down
 * credential-stuffing/brute-force attempts against a single process.
 *
 * This resets on deploy/restart and does not coordinate across instances.
 * If the app ever runs on multiple instances, move this to a shared store
 * (e.g. Redis) instead.
 */

interface Attempt {
  count: number;
  windowStartedAt: number;
}

const attemptsByKey = new Map<string, Attempt>();

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const attempt = attemptsByKey.get(key);

  if (!attempt || now - attempt.windowStartedAt > windowMs) {
    attemptsByKey.set(key, { count: 1, windowStartedAt: now });
    return false;
  }

  attempt.count += 1;
  return attempt.count > limit;
}

export function resetRateLimit(key: string): void {
  attemptsByKey.delete(key);
}
