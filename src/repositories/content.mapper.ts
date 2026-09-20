import type { AgeRating as PrismaAgeRating } from "@/generated/prisma/enums";
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

export function mapMovieToContentSummary(movie: MovieRecord): ContentSummary {
  return {
    id: movie.id,
    slug: movie.slug,
    title: movie.title,
    type: "MOVIE",
    releaseYear: movie.releaseYear,
    ageRating: AGE_RATING_LABELS[movie.ageRating],
    durationInMinutes: movie.durationInMinutes,
    synopsis: movie.synopsis,
    hasVideo: movie.videoMediaId !== null,
    genres: movie.genres,
    posterUrl: movie.poster?.url,
    backdropUrl: movie.backdrop?.url,
  };
}

export function mapSeriesToContentSummary(series: SeriesRecord): ContentSummary {
  return {
    id: series.id,
    slug: series.slug,
    title: series.title,
    type: "SERIES",
    releaseYear: series.releaseYear,
    ageRating: AGE_RATING_LABELS[series.ageRating],
    seasonCount: series._count.seasons,
    synopsis: series.synopsis,
    hasVideo: series.seasons.some((season) => season.episodes.length > 0),
    genres: series.genres,
    posterUrl: series.poster?.url,
    backdropUrl: series.backdrop?.url,
  };
}
