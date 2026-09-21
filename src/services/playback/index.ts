import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "./playback.types";

import { authorizedProvider } from "./providers/authorized.provider";
import { exampleProvider } from "./providers/example.provider";
import { internetArchiveProvider } from "./providers/internet-archive.provider";
import { testProvider } from "./providers/test.provider";

const providers: PlaybackProvider[] = [
  authorizedProvider,
  exampleProvider,
  internetArchiveProvider,
  testProvider,
];

/**
 * Runs every provider and keeps the sources of the ones that succeed.
 * A provider that throws is logged and skipped, so one failing provider
 * never hides the sources of the others.
 */
async function collectSources(
  request: (provider: PlaybackProvider) => Promise<PlaybackSource | null>
): Promise<PlaybackSource[]> {
  const results = await Promise.allSettled(
    providers.map((provider) => request(provider))
  );

  const sources: PlaybackSource[] = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `Provider de playback "${providers[index].id}" falhou:`,
        result.reason
      );
      return;
    }

    if (result.value !== null) {
      sources.push(result.value);
    }
  });

  return sources;
}

export async function getMoviePlaybackSources(
  tmdbId: number
): Promise<PlaybackSource[]> {
  const context: PlaybackContext = {
    tmdbId,
  };

  return collectSources((provider) => provider.getMovieSource(context));
}

export async function getEpisodePlaybackSources(
  tmdbId: number,
  season: number,
  episode: number
): Promise<PlaybackSource[]> {
  const context: PlaybackContext = {
    tmdbId,
    season,
    episode,
  };

  return collectSources((provider) => provider.getEpisodeSource(context));
}
