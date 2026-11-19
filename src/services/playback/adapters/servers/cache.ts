import type { AdapterFailure } from "../adapter.types";

/**
 * Single-value in-memory cache with a TTL and in-flight de-duplication: the
 * Xtream catalog or an M3U playlist is big, so concurrent discover() calls of
 * one sync share one download. Failures are never cached.
 */
export interface LoadingCache<T> {
  /** Cached value, else runs `loader` (once, even for concurrent callers). */
  load(loader: () => Promise<T | AdapterFailure>): Promise<T | AdapterFailure>;
  clear(): void;
}

export interface LoadingCacheOptions {
  ttlMs: number;
  /** Injected clock (tests). */
  now?: () => number;
}

export function createLoadingCache<T extends object>(
  options: LoadingCacheOptions,
): LoadingCache<T> {
  const now = options.now ?? Date.now;
  let entry: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T | AdapterFailure> | null = null;

  return {
    load(loader) {
      if (entry && entry.expiresAt > now()) {
        return Promise.resolve(entry.value);
      }

      if (inFlight) {
        return inFlight;
      }

      const running = (async (): Promise<T | AdapterFailure> => {
        const result = await loader();

        if (!("reason" in result)) {
          entry = { value: result, expiresAt: now() + options.ttlMs };
        }

        return result;
      })();
      const release = () => {
        if (inFlight === running) {
          inFlight = null;
        }
      };

      inFlight = running;
      running.then(release, release);
      return running;
    },

    clear() {
      entry = null;
    },
  };
}
