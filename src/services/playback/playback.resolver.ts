import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "./playback.types";

/** A provider that hangs (or is just slow) never blocks the others. */
const PROVIDER_TIMEOUT_MS = 5_000;

export interface PlaybackResolver {
  resolveMovie(context: PlaybackContext): Promise<PlaybackSource[]>;
  resolveEpisode(context: PlaybackContext): Promise<PlaybackSource[]>;
}

/**
 * Races a provider call against a timeout. This only stops the *aggregator*
 * from waiting on it — it can't cancel work already in flight inside the
 * provider (none of today's providers accept an AbortSignal), it just stops
 * counting that provider's result once the timeout wins.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  providerId: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Provider "${providerId}" excedeu ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Runs every provider in parallel and keeps the sources of the ones that
 * succeed within the timeout. A provider that throws, rejects, or times out
 * is logged and skipped — it never hides the sources of the others.
 */
function createCollector(providers: PlaybackProvider[]) {
  return async function collect(
    request: (provider: PlaybackProvider) => Promise<PlaybackSource | null>,
  ): Promise<PlaybackSource[]> {
    const results = await Promise.allSettled(
      providers.map((provider) =>
        withTimeout(request(provider), PROVIDER_TIMEOUT_MS, provider.id),
      ),
    );

    const sources: PlaybackSource[] = [];

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Provider de playback "${providers[index].id}" falhou:`,
          result.reason,
        );
        return;
      }

      if (result.value !== null) {
        sources.push(result.value);
      }
    });

    return sources;
  };
}

export function createPlaybackResolver(
  providers: PlaybackProvider[],
): PlaybackResolver {
  const collect = createCollector(providers);

  return {
    resolveMovie(context) {
      return collect((provider) => provider.getMovieSource(context));
    },
    resolveEpisode(context) {
      return collect((provider) => provider.getEpisodeSource(context));
    },
  };
}
