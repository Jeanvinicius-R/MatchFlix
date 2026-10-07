import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "./playback.types";

import {
  getMovieDetails,
  getSeasonDetails,
  getSeriesDetails,
} from "@/services/tmdb/tmdb.service";
import { createPlaybackResolver } from "./playback.resolver";
import { authorizedProvider } from "./providers/authorized.provider";
import { internetArchiveProvider } from "./providers/internet-archive.provider";
import { youtubeProvider } from "./providers/youtube.provider";

const providers: PlaybackProvider[] = [
  authorizedProvider,
  internetArchiveProvider,
  youtubeProvider,
];

const resolver = createPlaybackResolver(providers);

/**
 * Adds TMDB metadata (cached for a day by the TMDB client) to the context.
 * If TMDB fails, the id-only context still goes through — providers that
 * need the metadata just return null.
 */
async function withMovieMetadata(tmdbId: number): Promise<PlaybackContext> {
  try {
    const movie = await getMovieDetails(tmdbId);

    return {
      tmdbId,
      title: movie.title,
      originalTitle: movie.originalTitle,
      year: movie.releaseYear ?? undefined,
      runtimeMinutes: movie.durationInMinutes ?? undefined,
    };
  } catch (error) {
    console.warn("Playback: metadados TMDB do filme indisponíveis.", error);
    return { tmdbId };
  }
}

async function withEpisodeMetadata(
  tmdbId: number,
  season: number,
  episode: number
): Promise<PlaybackContext> {
  try {
    const [series, seasonDetails] = await Promise.all([
      getSeriesDetails(tmdbId),
      getSeasonDetails(tmdbId, season),
    ]);
    const details = seasonDetails.episodes.find(
      (item) => item.episodeNumber === episode
    );

    return {
      tmdbId,
      season,
      episode,
      title: series.title,
      originalTitle: series.originalTitle,
      year: series.releaseYear ?? undefined,
      episodeTitle: details?.title,
      runtimeMinutes: details?.durationInMinutes ?? undefined,
    };
  } catch (error) {
    console.warn("Playback: metadados TMDB do episódio indisponíveis.", error);
    return { tmdbId, season, episode };
  }
}

export async function getMoviePlaybackSources(
  tmdbId: number
): Promise<PlaybackSource[]> {
  return resolver.resolveMovie(await withMovieMetadata(tmdbId));
}

export async function getEpisodePlaybackSources(
  tmdbId: number,
  season: number,
  episode: number
): Promise<PlaybackSource[]> {
  return resolver.resolveEpisode(
    await withEpisodeMetadata(tmdbId, season, episode)
  );
}
