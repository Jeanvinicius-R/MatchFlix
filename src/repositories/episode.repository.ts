import { prisma } from "@/lib/prisma";
import { removeStoredFiles } from "@/lib/storage/local-storage";
import {
  createVideoMedia,
  deleteMediaIfPresent,
  type VideoMediaInput,
} from "@/repositories/media.repository";

export async function findEpisodeIdsOfSeries(seriesId: string): Promise<Set<string>> {
  const episodes = await prisma.episode.findMany({
    where: { season: { seriesId } },
    select: { id: true },
  });
  return new Set(episodes.map((episode) => episode.id));
}

/** Links many episodes to videos in one transaction, dropping each replaced Media row. */
export async function setEpisodeVideos(
  items: { episodeId: string; video: VideoMediaInput }[],
): Promise<void> {
  const orphans: (string | null)[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { episodeId, video } of items) {
      const current = await tx.episode.findUnique({
        where: { id: episodeId },
        select: { videoMediaId: true },
      });

      const mediaId = await createVideoMedia(tx, video);
      await tx.episode.update({
        where: { id: episodeId },
        data: { videoMediaId: mediaId },
      });
      orphans.push(await deleteMediaIfPresent(tx, current?.videoMediaId));
    }
  });
  await removeStoredFiles(orphans);
}

/** Returns false when the episode does not belong to that series. */
export async function clearEpisodeVideo(
  seriesId: string,
  episodeId: string,
): Promise<boolean> {
  const orphans: (string | null)[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.episode.findFirst({
      where: { id: episodeId, season: { seriesId } },
      select: { videoMediaId: true },
    });
    if (!current) {
      return false;
    }

    await tx.episode.update({ where: { id: episodeId }, data: { videoMediaId: null } });
    orphans.push(await deleteMediaIfPresent(tx, current.videoMediaId));
    return true;
  });
  await removeStoredFiles(orphans);
  return result;
}
