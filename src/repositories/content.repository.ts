import { prisma } from "@/lib/prisma";
import type { ContentSummary } from "@/types/content.types";
import {
  mapMovieToContentSummary,
  mapSeriesToContentSummary,
} from "@/repositories/content.mapper";
import { getPlayableLookup } from "@/services/playback/playable-titles.default";

export const MOVIE_SELECT = {
  id: true,
  slug: true,
  tmdbId: true,
  title: true,
  releaseYear: true,
  ageRating: true,
  durationInMinutes: true,
  synopsis: true,
  videoMediaId: true,
  genres: { select: { id: true, name: true, slug: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
} as const;

export const SERIES_SELECT = {
  id: true,
  slug: true,
  tmdbId: true,
  title: true,
  releaseYear: true,
  ageRating: true,
  synopsis: true,
  genres: { select: { id: true, name: true, slug: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
  _count: { select: { seasons: true } },
  // Only asks whether any episode has a video: one row is enough.
  seasons: {
    select: {
      episodes: { where: { videoMediaId: { not: null } }, take: 1, select: { id: true } },
    },
  },
} as const;

/** Kids profiles only ever see content rated "L" (livre para todos os públicos). */
export function ageRatingFilterFor(kidsOnly: boolean) {
  return kidsOnly ? ({ ageRating: "L" } as const) : {};
}

export async function findAllContent(kidsOnly = false): Promise<ContentSummary[]> {
  const ageRatingFilter = ageRatingFilterFor(kidsOnly);

  const [movies, series, playable] = await Promise.all([
    prisma.movie.findMany({
      where: { isActive: true, ...ageRatingFilter },
      select: MOVIE_SELECT,
    }),
    prisma.series.findMany({
      where: { isActive: true, ...ageRatingFilter },
      select: SERIES_SELECT,
    }),
    getPlayableLookup(),
  ]);

  return [
    ...movies.map((movie) => mapMovieToContentSummary(movie, playable)),
    ...series.map((item) => mapSeriesToContentSummary(item, playable)),
  ];
}

export async function findFeaturedContent(
  kidsOnly = false,
): Promise<ContentSummary | null> {
  const [movie, playable] = await Promise.all([
    prisma.movie.findFirst({
      where: { isActive: true, ...ageRatingFilterFor(kidsOnly) },
      orderBy: { createdAt: "asc" },
      select: MOVIE_SELECT,
    }),
    getPlayableLookup(),
  ]);

  return movie ? mapMovieToContentSummary(movie, playable) : null;
}

export async function findContentByGenreSlug(
  genreSlug: string,
  kidsOnly = false,
): Promise<ContentSummary[]> {
  const genreFilter = { genres: { some: { slug: genreSlug } } };
  const ageRatingFilter = ageRatingFilterFor(kidsOnly);

  const [movies, series, playable] = await Promise.all([
    prisma.movie.findMany({
      where: { isActive: true, ...genreFilter, ...ageRatingFilter },
      select: MOVIE_SELECT,
    }),
    prisma.series.findMany({
      where: { isActive: true, ...genreFilter, ...ageRatingFilter },
      select: SERIES_SELECT,
    }),
    getPlayableLookup(),
  ]);

  return [
    ...movies.map((movie) => mapMovieToContentSummary(movie, playable)),
    ...series.map((item) => mapSeriesToContentSummary(item, playable)),
  ];
}

export async function findAllMovies(kidsOnly = false): Promise<ContentSummary[]> {
  const [movies, playable] = await Promise.all([
    prisma.movie.findMany({
      where: { isActive: true, ...ageRatingFilterFor(kidsOnly) },
      orderBy: { title: "asc" },
      select: MOVIE_SELECT,
    }),
    getPlayableLookup(),
  ]);
  return movies.map((movie) => mapMovieToContentSummary(movie, playable));
}

export async function findAllSeries(kidsOnly = false): Promise<ContentSummary[]> {
  const [series, playable] = await Promise.all([
    prisma.series.findMany({
      where: { isActive: true, ...ageRatingFilterFor(kidsOnly) },
      orderBy: { title: "asc" },
      select: SERIES_SELECT,
    }),
    getPlayableLookup(),
  ]);
  return series.map((item) => mapSeriesToContentSummary(item, playable));
}

const CONTINUE_WATCHING_LIMIT = 20;

/**
 * One item per unfinished title, most recently watched first. A series
 * collapses to a single entry (its most recent episode in progress) even
 * if several episodes have progress rows — the row links to the series,
 * which already resumes from the right episode on its own.
 */
export async function findContinueWatching(
  profileId: string,
  kidsOnly = false,
): Promise<ContentSummary[]> {
  const ageRatingFilter = ageRatingFilterFor(kidsOnly);

  const [progress, playable] = await Promise.all([
    prisma.watchProgress.findMany({
      where: {
        profileId,
        completed: false,
        OR: [
          { movie: { isActive: true, ...ageRatingFilter } },
          { episode: { season: { series: { isActive: true, ...ageRatingFilter } } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: CONTINUE_WATCHING_LIMIT,
      select: {
        movie: { select: MOVIE_SELECT },
        episode: {
          select: { season: { select: { series: { select: SERIES_SELECT } } } },
        },
      },
    }),
    getPlayableLookup(),
  ]);

  const items: ContentSummary[] = [];
  const seenSeriesIds = new Set<string>();

  for (const row of progress) {
    if (row.movie) {
      items.push(mapMovieToContentSummary(row.movie, playable));
    } else if (row.episode && !seenSeriesIds.has(row.episode.season.series.id)) {
      seenSeriesIds.add(row.episode.season.series.id);
      items.push(mapSeriesToContentSummary(row.episode.season.series, playable));
    }
  }

  return items;
}

const SEARCH_RESULT_LIMIT = 60;

/** Case-insensitive match on the title or the original title, across movies and series. */
export async function searchContent(
  query: string,
  kidsOnly = false,
): Promise<ContentSummary[]> {
  const textFilter = {
    OR: [
      { title: { contains: query, mode: "insensitive" as const } },
      { originalTitle: { contains: query, mode: "insensitive" as const } },
    ],
  };
  const where = { isActive: true, ...ageRatingFilterFor(kidsOnly), ...textFilter };

  const [movies, series, playable] = await Promise.all([
    prisma.movie.findMany({
      where,
      orderBy: { title: "asc" },
      take: SEARCH_RESULT_LIMIT,
      select: MOVIE_SELECT,
    }),
    prisma.series.findMany({
      where,
      orderBy: { title: "asc" },
      take: SEARCH_RESULT_LIMIT,
      select: SERIES_SELECT,
    }),
    getPlayableLookup(),
  ]);

  return [
    ...movies.map((movie) => mapMovieToContentSummary(movie, playable)),
    ...series.map((item) => mapSeriesToContentSummary(item, playable)),
  ];
}

/** One page of a catalog listing plus the total, for the paginated catalog API. */
export interface LocalCatalogPage {
  items: ContentSummary[];
  total: number;
}

/** Active movies by title, `pageSize` at a time (`page` starts at 1). */
export async function findMoviesPage(
  page: number,
  pageSize: number,
  kidsOnly = false,
): Promise<LocalCatalogPage> {
  const where = { isActive: true, ...ageRatingFilterFor(kidsOnly) };
  const [movies, total, playable] = await Promise.all([
    prisma.movie.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: MOVIE_SELECT,
    }),
    prisma.movie.count({ where }),
    getPlayableLookup(),
  ]);
  return {
    items: movies.map((movie) => mapMovieToContentSummary(movie, playable)),
    total,
  };
}

/** Active series by title, `pageSize` at a time (`page` starts at 1). */
export async function findSeriesPage(
  page: number,
  pageSize: number,
  kidsOnly = false,
): Promise<LocalCatalogPage> {
  const where = { isActive: true, ...ageRatingFilterFor(kidsOnly) };
  const [series, total, playable] = await Promise.all([
    prisma.series.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: SERIES_SELECT,
    }),
    prisma.series.count({ where }),
    getPlayableLookup(),
  ]);
  return {
    items: series.map((item) => mapSeriesToContentSummary(item, playable)),
    total,
  };
}
