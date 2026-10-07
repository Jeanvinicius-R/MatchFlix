import { prisma } from "@/lib/prisma";
import { ageRatingFilterFor } from "@/repositories/content.repository";

/** Rows scanned per page view; the screen collapses them to one entry per title. */
const HISTORY_SCAN_LIMIT = 300;

const TITLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  releaseYear: true,
  poster: { select: { url: true } },
} as const;

/**
 * Most recent playback starts of one profile. Inactive titles and, for a kids
 * profile, anything not rated "L" are filtered out here — never in the UI.
 */
export function findWatchHistory(profileId: string, kidsOnly: boolean) {
  const ageRatingFilter = ageRatingFilterFor(kidsOnly);

  return prisma.watchHistory.findMany({
    where: {
      profileId,
      OR: [
        { movie: { isActive: true, ...ageRatingFilter } },
        { episode: { season: { series: { isActive: true, ...ageRatingFilter } } } },
      ],
    },
    orderBy: { watchedAt: "desc" },
    take: HISTORY_SCAN_LIMIT,
    select: {
      watchedAt: true,
      movie: { select: TITLE_SELECT },
      episode: {
        select: {
          id: true,
          episodeNumber: true,
          title: true,
          season: { select: { seasonNumber: true, series: { select: TITLE_SELECT } } },
        },
      },
    },
  });
}

export function findProgressForContent(
  profileId: string,
  movieIds: string[],
  episodeIds: string[],
) {
  return prisma.watchProgress.findMany({
    where: {
      profileId,
      OR: [{ movieId: { in: movieIds } }, { episodeId: { in: episodeIds } }],
    },
    select: {
      movieId: true,
      episodeId: true,
      positionInSeconds: true,
      durationInSeconds: true,
      completed: true,
    },
  });
}
