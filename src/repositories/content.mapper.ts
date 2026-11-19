import type { AgeRating as PrismaAgeRating } from "@/generated/prisma/enums";
import { hasKnownPlaybackSource } from "@/services/playback/availability";
import type { PlayableLookup } from "@/services/playback/playable-titles";
import type { AgeRating, ContentSummary, Genre } from "@/types/content.types";

/**
 * Converts Prisma's read models into the ContentSummary shape the rest of
 * the app depends on, so the UI and service layer never need to know the
 * database representation (enum spelling, nullable relations, etc.).
 */

interface MediaRef {
  url: string;
}

interface MovieRecord {
  id: string;
  slug: string;
  tmdbId: number | null;
  title: string;
  releaseYear: number;
  ageRating: PrismaAgeRating;
  durationInMinutes: number;
  synopsis: string;
  videoMediaId: string | null;
  genres: Genre[];
  poster: MediaRef | null;
  backdrop: MediaRef | null;
}

interface SeriesRecord {
  id: string;
  slug: string;
  tmdbId: number | null;
  title: string;
  releaseYear: number;
  ageRating: PrismaAgeRating;
  synopsis: string;
  genres: Genre[];
  poster: MediaRef | null;
  backdrop: MediaRef | null;
  _count: { seasons: number };
  seasons: { episodes: { id: string }[] }[];
}

export const AGE_RATING_LABELS: Record<PrismaAgeRating, AgeRating> = {
  L: "L",
  TEN: "10",
  TWELVE: "12",
  FOURTEEN: "14",
  SIXTEEN: "16",
  EIGHTEEN: "18",
};

/**
 * `playable` carries the titles with a CONFIRMED association (VERIFIED, found
 * AVAILABLE recently). Without it (not loaded, or the database failed) the
 * card keeps the previous rule: a linked file or a statically known source.
 */
export function mapMovieToContentSummary(
  movie: MovieRecord,
  playable?: PlayableLookup | null,
): ContentSummary {
  return {
    id: movie.id,
    slug: movie.slug,
    tmdbId: movie.tmdbId ?? undefined,
    title: movie.title,
    type: "MOVIE",
    releaseYear: movie.releaseYear,
    ageRating: AGE_RATING_LABELS[movie.ageRating],
    durationInMinutes: movie.durationInMinutes,
    synopsis: movie.synopsis,
    hasVideo:
      movie.videoMediaId !== null ||
      hasKnownPlaybackSource(movie.tmdbId, "movie") ||
      playable?.hasMovie(movie.tmdbId) === true,
    genres: movie.genres,
    posterUrl: movie.poster?.url,
    backdropUrl: movie.backdrop?.url,
  };
}

export function mapSeriesToContentSummary(
  series: SeriesRecord,
  playable?: PlayableLookup | null,
): ContentSummary {
  return {
    id: series.id,
    slug: series.slug,
    tmdbId: series.tmdbId ?? undefined,
    title: series.title,
    type: "SERIES",
    releaseYear: series.releaseYear,
    ageRating: AGE_RATING_LABELS[series.ageRating],
    seasonCount: series._count.seasons,
    synopsis: series.synopsis,
    hasVideo:
      series.seasons.some((season) => season.episodes.length > 0) ||
      hasKnownPlaybackSource(series.tmdbId, "series") ||
      playable?.hasSeries(series.tmdbId) === true,
    genres: series.genres,
    posterUrl: series.poster?.url,
    backdropUrl: series.backdrop?.url,
  };
}
