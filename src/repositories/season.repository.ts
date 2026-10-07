import { prisma } from "@/lib/prisma";
import type { SeasonImportInput } from "@/repositories/series.repository";

export interface SeasonSyncReport {
  seasonsCreated: number;
  seasonsUpdated: number;
  episodesCreated: number;
  episodesUpdated: number;
}

/**
 * Merges TMDB seasons into an existing series without deleting anything:
 * missing seasons/episodes are created; existing ones are only rewritten when
 * `updateExisting` is set, and even then only their text fields — a linked
 * video (videoMediaId) is never touched. Unique (seriesId, seasonNumber) and
 * (seasonId, episodeNumber) keys make duplicates impossible.
 */
export async function mergeSeasons(
  seriesId: string,
  seasons: SeasonImportInput[],
  updateExisting: boolean,
): Promise<SeasonSyncReport> {
  const report: SeasonSyncReport = {
    seasonsCreated: 0,
    seasonsUpdated: 0,
    episodesCreated: 0,
    episodesUpdated: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      for (const season of seasons) {
        const existingSeason = await tx.season.findUnique({
          where: { seriesId_seasonNumber: { seriesId, seasonNumber: season.seasonNumber } },
          select: { id: true, episodes: { select: { id: true, episodeNumber: true } } },
        });

        if (!existingSeason) {
          await tx.season.create({
            data: {
              seriesId,
              seasonNumber: season.seasonNumber,
              title: season.title,
              synopsis: season.synopsis,
              releaseYear: season.releaseYear,
              episodes: { create: season.episodes },
            },
          });
          report.seasonsCreated += 1;
          report.episodesCreated += season.episodes.length;
          continue;
        }

        if (updateExisting) {
          await tx.season.update({
            where: { id: existingSeason.id },
            data: { title: season.title, synopsis: season.synopsis },
          });
          report.seasonsUpdated += 1;
        }

        const episodeIdByNumber = new Map(
          existingSeason.episodes.map((episode) => [episode.episodeNumber, episode.id]),
        );
        for (const episode of season.episodes) {
          const episodeId = episodeIdByNumber.get(episode.episodeNumber);
          if (!episodeId) {
            await tx.episode.create({ data: { seasonId: existingSeason.id, ...episode } });
            report.episodesCreated += 1;
          } else if (updateExisting) {
            await tx.episode.update({
              where: { id: episodeId },
              data: {
                title: episode.title,
                synopsis: episode.synopsis,
                durationInMinutes: episode.durationInMinutes,
              },
            });
            report.episodesUpdated += 1;
          }
        }
      }
    },
    // Long shows mean many small writes; the default 5 s is too tight over the network.
    { timeout: 60_000, maxWait: 10_000 },
  );

  return report;
}

export function findSeasonOfSeries(seriesId: string, seasonId: string) {
  return prisma.season.findFirst({ where: { id: seasonId, seriesId }, select: { id: true } });
}

export function findSeasonByNumber(seriesId: string, seasonNumber: number) {
  return prisma.season.findUnique({
    where: { seriesId_seasonNumber: { seriesId, seasonNumber } },
    select: { id: true },
  });
}

export async function createSeason(
  seriesId: string,
  data: { seasonNumber: number; title: string | null },
): Promise<void> {
  await prisma.season.create({ data: { seriesId, ...data } });
}

export function findEpisodeByNumber(seasonId: string, episodeNumber: number) {
  return prisma.episode.findUnique({
    where: { seasonId_episodeNumber: { seasonId, episodeNumber } },
    select: { id: true },
  });
}

export function findEpisodeOfSeries(seriesId: string, episodeId: string) {
  return prisma.episode.findFirst({
    where: { id: episodeId, season: { seriesId } },
    select: { id: true },
  });
}

export interface EpisodeFields {
  title: string;
  synopsis: string | null;
  durationInMinutes: number | null;
}

export async function createEpisode(
  seasonId: string,
  data: EpisodeFields & { episodeNumber: number },
): Promise<void> {
  await prisma.episode.create({ data: { seasonId, ...data } });
}

/** Text fields only — the linked video stays as it is. */
export async function updateEpisodeFields(episodeId: string, data: EpisodeFields): Promise<void> {
  await prisma.episode.update({ where: { id: episodeId }, data });
}
