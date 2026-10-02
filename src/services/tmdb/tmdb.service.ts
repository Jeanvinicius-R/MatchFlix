import { tmdbGet } from "@/services/tmdb/tmdb.client";
import {
  mapMovieDetails,
  mapMovieSearchResult,
  mapSeasonDetails,
  mapSeriesDetails,
  mapSeriesSearchResult,
  mapWatchProviders,
} from "@/services/tmdb/tmdb.mapper";
import type {
  TmdbGenre,
  TmdbGenreListResponse,
  TmdbMovieDetails,
  TmdbMovieDetailsRaw,
  TmdbMovieSearchResult,
  TmdbMovieSearchResultRaw,
  TmdbSearchResponse,
  TmdbSeasonDetails,
  TmdbSeasonDetailsRaw,
  TmdbSeriesDetails,
  TmdbSeriesDetailsRaw,
  TmdbSeriesSearchResult,
  TmdbSeriesSearchResultRaw,
  TmdbWatchProviders,
  TmdbWatchProvidersRaw,
} from "@/services/tmdb/tmdb.types";

/** "Onde assistir" only ever targets Brazil — this is a Brazilian catalog. */
const WATCH_PROVIDERS_REGION = "BR";

/**
 * Business-facing operations for browsing TMDB's catalog. This is the only
 * module the rest of the app (future admin forms/routes) should import from
 * — never tmdb.client.ts or tmdb.types.ts directly.
 */

export async function searchMovies(query: string): Promise<TmdbMovieSearchResult[]> {
  const response = await tmdbGet<TmdbSearchResponse<TmdbMovieSearchResultRaw>>(
    "/search/movie",
    { searchParams: { query } },
  );
  return response.results.map(mapMovieSearchResult);
}

export async function searchSeries(query: string): Promise<TmdbSeriesSearchResult[]> {
  const response = await tmdbGet<TmdbSearchResponse<TmdbSeriesSearchResultRaw>>(
    "/search/tv",
    {
      searchParams: { query },
    },
  );
  return response.results.map(mapSeriesSearchResult);
}

export async function getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
  const raw = await tmdbGet<TmdbMovieDetailsRaw>(`/movie/${tmdbId}`, {
    searchParams: { append_to_response: "release_dates" },
  });
  return mapMovieDetails(raw);
}

export async function getSeriesDetails(tmdbId: number): Promise<TmdbSeriesDetails> {
  const raw = await tmdbGet<TmdbSeriesDetailsRaw>(`/tv/${tmdbId}`, {
    searchParams: { append_to_response: "content_ratings" },
  });
  return mapSeriesDetails(raw);
}

export async function getSeasonDetails(
  tmdbId: number,
  seasonNumber: number,
): Promise<TmdbSeasonDetails> {
  const raw = await tmdbGet<TmdbSeasonDetailsRaw>(`/tv/${tmdbId}/season/${seasonNumber}`);
  return mapSeasonDetails(raw);
}

export async function getMovieGenres(): Promise<TmdbGenre[]> {
  const response = await tmdbGet<TmdbGenreListResponse>("/genre/movie/list");
  return response.genres;
}

export async function getSeriesGenres(): Promise<TmdbGenre[]> {
  const response = await tmdbGet<TmdbGenreListResponse>("/genre/tv/list");
  return response.genres;
}

/** "Where to watch" — never a playback source, see src/features/watch/components/WhereToWatch.tsx. */
export async function getMovieWatchProviders(tmdbId: number): Promise<TmdbWatchProviders> {
  const raw = await tmdbGet<TmdbWatchProvidersRaw>(`/movie/${tmdbId}/watch/providers`);
  return mapWatchProviders(raw, WATCH_PROVIDERS_REGION);
}

export async function getSeriesWatchProviders(tmdbId: number): Promise<TmdbWatchProviders> {
  const raw = await tmdbGet<TmdbWatchProvidersRaw>(`/tv/${tmdbId}/watch/providers`);
  return mapWatchProviders(raw, WATCH_PROVIDERS_REGION);
}
