import type { AgeRating } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  createImageMedia,
  deleteMediaIfPresent,
  type ImageUrls,
} from "@/repositories/media.repository";

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
  tmdbId: true,
  title: true,
  originalTitle: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  isActive: true,
  genres: { select: { id: true, name: true, slug: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
  createdAt: true,
  updatedAt: true,
  seasons: {
    orderBy: { seasonNumber: "asc" },
    select: {
      id: true,
      seasonNumber: true,
      title: true,
      _count: { select: { episodes: true } },
      episodes: {
        orderBy: { episodeNumber: "asc" },
        select: {
          id: true,
          episodeNumber: true,
          title: true,
          video: { select: { fileName: true } },
        },
      },
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

export function findSeriesByTmdbId(tmdbId: number) {
  return prisma.series.findUnique({ where: { tmdbId }, select: { id: true } });
}

/** One prisma.series.create call with nested seasons/episodes — no per-season round trip against the DB. */
export function createSeriesWithSeasons(
  data: SeriesScalarInput & {
    slug: string;
    genreIds: string[];
    seasons: SeasonImportInput[];
    tmdbId: number | null;
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
  data: SeriesScalarInput & {
    slug: string;
    genreIds: string[];
    /** undefined leaves the stored tmdbId untouched. */
    tmdbId?: number;
  },
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

/** See setMovieImages: null/undefined leaves that image untouched. */
export async function setSeriesImages(
  seriesId: string,
  { posterUrl, backdropUrl }: ImageUrls,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.series.findUnique({
      where: { id: seriesId },
      select: { posterMediaId: true, backdropMediaId: true },
    });

    if (posterUrl) {
      const mediaId = await createImageMedia(tx, "POSTER", posterUrl);
      await tx.series.update({
        where: { id: seriesId },
        data: { posterMediaId: mediaId },
      });
      await deleteMediaIfPresent(tx, current?.posterMediaId);
    }
    if (backdropUrl) {
      const mediaId = await createImageMedia(tx, "BACKDROP", backdropUrl);
      await tx.series.update({
        where: { id: seriesId },
        data: { backdropMediaId: mediaId },
      });
      await deleteMediaIfPresent(tx, current?.backdropMediaId);
    }
  });
}
