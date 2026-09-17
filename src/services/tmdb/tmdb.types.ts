import type { AgeRating } from "@/types/content.types";

// ---------------------------------------------------------------------------
// Raw shapes returned by the TMDB API (https://developer.themoviedb.org).
// Field names follow TMDB's own casing (snake_case) on purpose — this is
// exactly what the API sends, nothing more. Never import these outside
// tmdb.client.ts / tmdb.mapper.ts.
// ---------------------------------------------------------------------------

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbGenreListResponse {
  genres: TmdbGenre[];
}

export interface TmdbSearchResponse<TResult> {
  page: number;
  results: TResult[];
  total_pages: number;
  total_results: number;
}

export interface TmdbMovieSearchResultRaw {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbSeriesSearchResultRaw {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbReleaseDateEntry {
  certification: string;
  iso_639_1: string;
  release_date: string;
  type: number;
}

export interface TmdbReleaseDatesResponse {
  results: { iso_3166_1: string; release_dates: TmdbReleaseDateEntry[] }[];
}

export interface TmdbMovieDetailsRaw {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string | null;
  runtime: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TmdbGenre[];
  /** Present when the request appends `release_dates` (used for the BR age rating). */
  release_dates?: TmdbReleaseDatesResponse;
}

export interface TmdbContentRatingsResponse {
  results: { iso_3166_1: string; rating: string }[];
}

export interface TmdbSeasonSummaryRaw {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  poster_path: string | null;
  episode_count: number;
}

export interface TmdbSeriesDetailsRaw {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TmdbGenre[];
  seasons: TmdbSeasonSummaryRaw[];
  /** Present when the request appends `content_ratings` (used for the BR age rating). */
  content_ratings?: TmdbContentRatingsResponse;
}

export interface TmdbEpisodeRaw {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
}

export interface TmdbSeasonDetailsRaw {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  poster_path: string | null;
  episodes: TmdbEpisodeRaw[];
}

// ---------------------------------------------------------------------------
// Internal shapes produced by tmdb.mapper.ts. This is what the rest of the
// app (future admin forms, API routes) is allowed to depend on — never the
// raw shapes above. Swapping metadata providers later only means rewriting
// tmdb.mapper.ts to still produce these same shapes.
// ---------------------------------------------------------------------------

export interface TmdbMovieSearchResult {
  tmdbId: number;
  title: string;
  originalTitle: string;
  releaseYear: number | null;
  posterUrl: string | null;
}

export interface TmdbSeriesSearchResult {
  tmdbId: number;
  title: string;
  originalTitle: string;
  releaseYear: number | null;
  posterUrl: string | null;
}

export interface TmdbMovieDetails {
  tmdbId: number;
  title: string;
  originalTitle: string;
  synopsis: string;
  releaseYear: number | null;
  durationInMinutes: number | null;
  /** Brazilian classification (ANCINE), when TMDB has it — null otherwise. */
  ageRating: AgeRating | null;
  genreNames: string[];
  posterUrl: string | null;
  backdropUrl: string | null;
}

export interface TmdbSeasonSummary {
  seasonNumber: number;
  title: string;
  episodeCount: number;
  posterUrl: string | null;
}

export interface TmdbSeriesDetails {
  tmdbId: number;
  title: string;
  originalTitle: string;
  synopsis: string;
  releaseYear: number | null;
  ageRating: AgeRating | null;
  genreNames: string[];
  posterUrl: string | null;
  backdropUrl: string | null;
  seasons: TmdbSeasonSummary[];
}

export interface TmdbEpisodeSummary {
  episodeNumber: number;
  title: string;
  synopsis: string;
  durationInMinutes: number | null;
  thumbnailUrl: string | null;
}

export interface TmdbSeasonDetails {
  seasonNumber: number;
  title: string;
  synopsis: string;
  posterUrl: string | null;
  episodes: TmdbEpisodeSummary[];
}
