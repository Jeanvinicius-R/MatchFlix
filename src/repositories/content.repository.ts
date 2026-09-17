import { prisma } from "@/lib/prisma";
import type { ContentSummary } from "@/types/content.types";
import {
  mapMovieToContentSummary,
  mapSeriesToContentSummary,
} from "@/repositories/content.mapper";

const MOVIE_SELECT = {
  id: true,
  slug: true,
  title: true,
  releaseYear: true,
  ageRating: true,
  durationInMinutes: true,
  synopsis: true,
  genres: { select: { id: true, name: true, slug: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
} as const;

const SERIES_SELECT = {
  id: true,
  slug: true,
  title: true,
  releaseYear: true,
  ageRating: true,
  synopsis: true,
  genres: { select: { id: true, name: true, slug: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
  _count: { select: { seasons: true } },
} as const;

/** Kids profiles only ever see content rated "L" (livre para todos os públicos). */
function ageRatingFilterFor(kidsOnly: boolean) {
  return kidsOnly ? ({ ageRating: "L" } as const) : {};
}

export async function findAllContent(kidsOnly = false): Promise<ContentSummary[]> {
  const ageRatingFilter = ageRatingFilterFor(kidsOnly);

  const [movies, series] = await Promise.all([
    prisma.movie.findMany({
      where: { isActive: true, ...ageRatingFilter },
      select: MOVIE_SELECT,
    }),
    prisma.series.findMany({
      where: { isActive: true, ...ageRatingFilter },
      select: SERIES_SELECT,
    }),
  ]);

  return [
    ...movies.map(mapMovieToContentSummary),
    ...series.map(mapSeriesToContentSummary),
  ];
}

export async function findFeaturedContent(
  kidsOnly = false,
): Promise<ContentSummary | null> {
  const movie = await prisma.movie.findFirst({
    where: { isActive: true, ...ageRatingFilterFor(kidsOnly) },
    orderBy: { createdAt: "asc" },
    select: MOVIE_SELECT,
  });

  return movie ? mapMovieToContentSummary(movie) : null;
}

export async function findContentByGenreSlug(
  genreSlug: string,
  kidsOnly = false,
): Promise<ContentSummary[]> {
  const genreFilter = { genres: { some: { slug: genreSlug } } };
  const ageRatingFilter = ageRatingFilterFor(kidsOnly);

  const [movies, series] = await Promise.all([
    prisma.movie.findMany({
      where: { isActive: true, ...genreFilter, ...ageRatingFilter },
      select: MOVIE_SELECT,
    }),
    prisma.series.findMany({
      where: { isActive: true, ...genreFilter, ...ageRatingFilter },
      select: SERIES_SELECT,
    }),
  ]);

  return [
    ...movies.map(mapMovieToContentSummary),
    ...series.map(mapSeriesToContentSummary),
  ];
}
