import { prisma } from "@/lib/prisma";

const SERIES_PLAYBACK_SELECT = {
  id: true,
  slug: true,
  title: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  isActive: true,
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
  seasons: {
    orderBy: { seasonNumber: "asc" },
    select: {
      id: true,
      seasonNumber: true,
      title: true,
      episodes: {
        orderBy: { episodeNumber: "asc" },
        select: {
          id: true,
          episodeNumber: true,
          title: true,
          synopsis: true,
          video: { select: { url: true, mimeType: true } },
        },
      },
    },
  },
} as const;

export function findSeriesForPlaybackBySlug(slug: string) {
  return prisma.series.findUnique({ where: { slug }, select: SERIES_PLAYBACK_SELECT });
}

export function findMovieProgress(profileId: string, movieId: string) {
  return prisma.watchProgress.findUnique({
    where: { profileId_movieId: { profileId, movieId } },
    select: { positionInSeconds: true, completed: true },
  });
}

/** Progress rows of one profile for every episode of a series, most recent first. */
export function findSeriesProgress(profileId: string, seriesId: string) {
  return prisma.watchProgress.findMany({
    where: { profileId, episode: { season: { seriesId } } },
    orderBy: { updatedAt: "desc" },
    select: {
      episodeId: true,
      positionInSeconds: true,
      completed: true,
    },
  });
}

interface ProgressValues {
  positionInSeconds: number;
  durationInSeconds: number;
  completed: boolean;
}

export async function upsertMovieProgress(
  profileId: string,
  movieId: string,
  values: ProgressValues,
): Promise<void> {
  await prisma.watchProgress.upsert({
    where: { profileId_movieId: { profileId, movieId } },
    create: { profileId, movieId, ...values },
    update: values,
  });
}

export async function upsertEpisodeProgress(
  profileId: string,
  episodeId: string,
  values: ProgressValues,
): Promise<void> {
  await prisma.watchProgress.upsert({
    where: { profileId_episodeId: { profileId, episodeId } },
    create: { profileId, episodeId, ...values },
    update: values,
  });
}

export async function insertWatchHistory(
  profileId: string,
  target: { movieId: string } | { episodeId: string },
): Promise<void> {
  await prisma.watchHistory.create({ data: { profileId, ...target } });
}
