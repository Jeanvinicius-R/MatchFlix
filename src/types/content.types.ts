/**
 * Domain types for browsable content (movies and series).
 * These mirror the future Prisma models (Movie, Series, Genre) at a
 * read-model level, so the UI layer will not need to change shape when
 * real data replaces the mock repository.
 */

export type ContentType = "MOVIE" | "SERIES";

export type AgeRating = "L" | "10" | "12" | "14" | "16" | "18";

export interface Genre {
  id: string;
  name: string;
  slug: string;
}

export interface ContentSummary {
  id: string;
  slug: string;
  title: string;
  type: ContentType;
  releaseYear: number;
  ageRating: AgeRating;
  durationInMinutes?: number;
  seasonCount?: number;
  synopsis: string;
  /** False until at least one video (or, for series, one episode video) is linked. */
  hasVideo: boolean;
  genres: Genre[];
  /** Absent until the media pipeline (uploads/CDN) exists; UI falls back to a styled placeholder. */
  posterUrl?: string;
  backdropUrl?: string;
}

export interface ContentRow {
  id: string;
  title: string;
  items: ContentSummary[];
}
