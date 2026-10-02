import type { PlaybackProvider, PlaybackSource } from "./playback.types";

import { createPlaybackResolver } from "./playback.resolver";
import { authorizedProvider } from "./providers/authorized.provider";
import { exampleProvider } from "./providers/example.provider";
import { internetArchiveProvider } from "./providers/internet-archive.provider";

const providers: PlaybackProvider[] = [
  authorizedProvider,
  exampleProvider,
  internetArchiveProvider,
];

const resolver = createPlaybackResolver(providers);

export async function getMoviePlaybackSources(
  tmdbId: number
): Promise<PlaybackSource[]> {
  return resolver.resolveMovie({ tmdbId });
}

export async function getEpisodePlaybackSources(
  tmdbId: number,
  season: number,
  episode: number
): Promise<PlaybackSource[]> {
  return resolver.resolveEpisode({ tmdbId, season, episode });
}
