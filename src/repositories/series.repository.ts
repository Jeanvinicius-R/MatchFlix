import type { AgeRating } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

const ADMIN_SERIES_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  originalTitle: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  isActive: true,
  genres: { select: { id: true, name: true, slug: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { seasons: true } },
} as const;

const ADMIN_SERIES_DETAIL_SELECT = {
  id: true,
  slug: true,
  title: true,
  originalTitle: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  isActive: true,
  genres: { select: { id: true, name: true, slug: true } },
  createdAt: true,
  updatedAt: true,
  seasons: {
    orderBy: { seasonNumber: "asc" },
    select: {
      id: true,
      seasonNumber: true,
      title: true,
      _count: { select: { episodes: true } },
    },
  },
} as const;

export type AdminSeriesListItem = Awaited<
  ReturnType<typeof findAllSeriesForAdmin>
>[number];
export type AdminSeriesDetail = Awaited<ReturnType<typeof findSeriesByIdForAdmin>>;

interface SeriesScalarInput {
  title: string;
  originalTitle: string | null;
  synopsis: string;
  releaseYear: number;
  ageRating: AgeRating;
}

export interface SeasonImportInput {
  seasonNumber: number;
  title: string;
  synopsis: string;
  releaseYear: number | null;
  episodes: {
    episodeNumber: number;
    title: string;
    synopsis: string;
    durationInMinutes: number | null;
  }[];
}

export function findAllSeriesForAdmin() {
  return prisma.series.findMany({
    orderBy: { title: "asc" },
    select: ADMIN_SERIES_LIST_SELECT,
  });
}

export function findSeriesByIdForAdmin(id: string) {
  return prisma.series.findUnique({ where: { id }, select: ADMIN_SERIES_DETAIL_SELECT });
}

export function findSeriesBySlug(slug: string) {
  return prisma.series.findUnique({ where: { slug }, select: { id: true } });
}

/** One prisma.series.create call with nested seasons/episodes — no per-season round trip against the DB. */
export function createSeriesWithSeasons(
  data: SeriesScalarInput & {
    slug: string;
    genreIds: string[];
    seasons: SeasonImportInput[];
  },
) {
  const { genreIds, seasons, ...scalars } = data;
  return prisma.series.create({
    data: {
      ...scalars,
      genres: { connect: genreIds.map((id) => ({ id })) },
      seasons: {
        create: seasons.map((season) => ({
          seasonNumber: season.seasonNumber,
          title: season.title,
          synopsis: season.synopsis,
          releaseYear: season.releaseYear,
          episodes: {
            create: season.episodes.map((episode) => ({
              episodeNumber: episode.episodeNumber,
              title: episode.title,
              synopsis: episode.synopsis,
              durationInMinutes: episode.durationInMinutes,
            })),
          },
        })),
      },
    },
    select: ADMIN_SERIES_DETAIL_SELECT,
  });
}

/** Series-level fields only — seasons/episodes are never touched here (see README limitation). */
export function updateSeries(
  id: string,
  data: SeriesScalarInput & { slug: string; genreIds: string[] },
) {
  const { genreIds, ...scalars } = data;
  return prisma.series.update({
    where: { id },
    data: { ...scalars, genres: { set: genreIds.map((id) => ({ id })) } },
    select: ADMIN_SERIES_DETAIL_SELECT,
  });
}

export async function setSeriesActive(id: string, isActive: boolean): Promise<void> {
  await prisma.series.update({ where: { id }, data: { isActive } });
}
