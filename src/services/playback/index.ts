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
import { findPlayableCandidates } from "@/repositories/playback-association.repository";
import { adapters } from "./adapters/registry";
import { createPlaybackResolver } from "./playback.resolver";
import { authorizedProvider } from "./providers/authorized.provider";
import { createAssociationProvider } from "./providers/association.provider";
import { internetArchiveProvider } from "./providers/internet-archive.provider";
import { youtubeProvider } from "./providers/youtube.provider";

// One provider per adapter, fed by the admin-managed PlaybackAssociation table.
// They only play associations marked VERIFIED, so they go first: a verified
// direct/HLS source is a better default than an embedded iframe.
const associationProviders: PlaybackProvider[] = adapters.map((adapter) =>
  createAssociationProvider({
    adapter,
    repository: { findPlayableCandidates },
  }),
);

const providers: PlaybackProvider[] = [
  ...associationProviders,
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
async function withMovieMetadata(
  tmdbId: number,
  viewerId: string | undefined
): Promise<PlaybackContext> {
  try {
    const movie = await getMovieDetails(tmdbId);

    return {
      tmdbId,
      viewerId,
      title: movie.title,
      originalTitle: movie.originalTitle,
      year: movie.releaseYear ?? undefined,
      runtimeMinutes: movie.durationInMinutes ?? undefined,
    };
  } catch (error) {
    console.warn("Playback: metadados TMDB do filme indisponíveis.", error);
    return { tmdbId, viewerId };
  }
}

async function withEpisodeMetadata(
  tmdbId: number,
  season: number,
  episode: number,
  viewerId: string | undefined
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
      viewerId,
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
    return { tmdbId, viewerId, season, episode };
  }
}

/** `viewerId` is the signed-in user (needed for sources served via the media proxy). */
export async function getMoviePlaybackSources(
  tmdbId: number,
  viewerId?: string
): Promise<PlaybackSource[]> {
  return resolver.resolveMovie(await withMovieMetadata(tmdbId, viewerId));
}

export async function getEpisodePlaybackSources(
  tmdbId: number,
  season: number,
  episode: number,
  viewerId?: string
): Promise<PlaybackSource[]> {
  return resolver.resolveEpisode(
    await withEpisodeMetadata(tmdbId, season, episode, viewerId)
  );
}
