import type { AgeRating } from "@/types/content.types";
import { buildTmdbImageUrl } from "@/services/tmdb/tmdb.client";
import type {
  TmdbMovieDetails,
  TmdbMovieDetailsRaw,
  TmdbMovieSearchResult,
  TmdbMovieSearchResultRaw,
  TmdbSeasonDetails,
  TmdbSeasonDetailsRaw,
  TmdbSeasonSummary,
  TmdbSeasonSummaryRaw,
  TmdbSeriesDetails,
  TmdbSeriesDetailsRaw,
  TmdbSeriesSearchResult,
  TmdbSeriesSearchResultRaw,
} from "@/services/tmdb/tmdb.types";

/**
 * Converts TMDB's external response shapes into the internal shapes the
 * rest of the app depends on. Nothing outside this module (or tmdb.types.ts)
 * should ever see a `snake_case` TMDB field directly.
 */

const BRAZILIAN_AGE_RATINGS: readonly AgeRating[] = ["L", "10", "12", "14", "16", "18"];

function extractReleaseYear(dateString: string | null | undefined): number | null {
  if (!dateString) {
    return null;
  }
  const year = Number(dateString.slice(0, 4));
  return Number.isNaN(year) ? null : year;
}

function toAgeRating(certification: string | undefined): AgeRating | null {
  const normalized = certification?.trim();
  const match = BRAZILIAN_AGE_RATINGS.find((rating) => rating === normalized);
  return match ?? null;
}

export function mapMovieSearchResult(
  raw: TmdbMovieSearchResultRaw,
): TmdbMovieSearchResult {
  return {
    tmdbId: raw.id,
    title: raw.title,
    originalTitle: raw.original_title,
    releaseYear: extractReleaseYear(raw.release_date),
    posterUrl: buildTmdbImageUrl(raw.poster_path, "w500"),
  };
}

export function mapSeriesSearchResult(
  raw: TmdbSeriesSearchResultRaw,
): TmdbSeriesSearchResult {
  return {
    tmdbId: raw.id,
    title: raw.name,
    originalTitle: raw.original_name,
    releaseYear: extractReleaseYear(raw.first_air_date),
    posterUrl: buildTmdbImageUrl(raw.poster_path, "w500"),
  };
}

export function mapMovieDetails(raw: TmdbMovieDetailsRaw): TmdbMovieDetails {
  const brazilianRelease = raw.release_dates?.results.find(
    (entry) => entry.iso_3166_1 === "BR",
  );
  const certification = brazilianRelease?.release_dates.find(
    (entry) => entry.certification,
  )?.certification;

  return {
    tmdbId: raw.id,
    title: raw.title,
    originalTitle: raw.original_title,
    synopsis: raw.overview,
    releaseYear: extractReleaseYear(raw.release_date),
    durationInMinutes: raw.runtime,
    ageRating: toAgeRating(certification),
    genreNames: raw.genres.map((genre) => genre.name),
    posterUrl: buildTmdbImageUrl(raw.poster_path, "w500"),
    backdropUrl: buildTmdbImageUrl(raw.backdrop_path, "w1280"),
  };
}

function mapSeasonSummary(raw: TmdbSeasonSummaryRaw): TmdbSeasonSummary {
  return {
    seasonNumber: raw.season_number,
    title: raw.name,
    episodeCount: raw.episode_count,
    posterUrl: buildTmdbImageUrl(raw.poster_path, "w500"),
  };
}

export function mapSeriesDetails(raw: TmdbSeriesDetailsRaw): TmdbSeriesDetails {
  const brazilianRating = raw.content_ratings?.results.find(
    (entry) => entry.iso_3166_1 === "BR",
  );

  return {
    tmdbId: raw.id,
    title: raw.name,
    originalTitle: raw.original_name,
    synopsis: raw.overview,
    releaseYear: extractReleaseYear(raw.first_air_date),
    ageRating: toAgeRating(brazilianRating?.rating),
    genreNames: raw.genres.map((genre) => genre.name),
    posterUrl: buildTmdbImageUrl(raw.poster_path, "w500"),
    backdropUrl: buildTmdbImageUrl(raw.backdrop_path, "w1280"),
    // Season 0 is TMDB's convention for "specials" — not a real season.
    seasons: raw.seasons
      .filter((season) => season.season_number > 0)
      .map(mapSeasonSummary),
  };
}

export function mapSeasonDetails(raw: TmdbSeasonDetailsRaw): TmdbSeasonDetails {
  return {
    seasonNumber: raw.season_number,
    title: raw.name,
    synopsis: raw.overview,
    posterUrl: buildTmdbImageUrl(raw.poster_path, "w500"),
    episodes: raw.episodes.map((episode) => ({
      episodeNumber: episode.episode_number,
      title: episode.name,
      synopsis: episode.overview,
      durationInMinutes: episode.runtime,
      thumbnailUrl: buildTmdbImageUrl(episode.still_path, "w500"),
    })),
  };
}
