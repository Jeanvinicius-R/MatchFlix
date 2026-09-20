import {
  clearEpisodeVideo,
  findEpisodeIdsOfSeries,
  setEpisodeVideos,
} from "@/repositories/episode.repository";
import {
  createSeriesWithSeasons,
  findAllSeriesForAdmin,
  findSeriesByIdForAdmin,
  findSeriesBySlug,
  type SeasonImportInput,
  setSeriesActive as setSeriesActiveRecord,
  setSeriesImages,
  updateSeries as updateSeriesRecord,
} from "@/repositories/series.repository";
import { upsertGenresByName } from "@/services/genre.service";
import { getSeasonDetails } from "@/services/tmdb/tmdb.service";
import type { SeriesFormInput, UpdateSeriesFormInput } from "@/schemas/series.schemas";
import type { AssignEpisodeVideosInput } from "@/schemas/video-source.schemas";
import { fetchSeriesImages } from "@/services/content-images.service";
import { getVideoSourceProvider } from "@/services/video-sources";
import { VideoSourceError } from "@/services/video-sources/video-source.errors";
import { mapAgeRatingLabelToEnum } from "@/utils/age-rating.utils";
import { generateUniqueSlug, slugify, SlugAlreadyInUseError } from "@/utils/slug.utils";

export class SeriesNotFoundError extends Error {
  constructor() {
    super("Série não encontrada.");
    this.name = "SeriesNotFoundError";
  }
}

export function listSeriesForAdmin() {
  return findAllSeriesForAdmin();
}

export async function getSeriesForAdmin(id: string) {
  const series = await findSeriesByIdForAdmin(id);
  if (!series) {
    throw new SeriesNotFoundError();
  }
  return series;
}

/**
 * Fetches every requested season's episodes from TMDB, one at a time.
 * Sequential on purpose: tmdbGet has no built-in throttling, and staying
 * sequential keeps this comfortably under TMDB's rate limit even for
 * shows with many seasons — see plan's risk #1 if this ever needs batching.
 */
async function importSeasonsFromTmdb(
  tmdbId: number,
  seasonNumbers: number[],
): Promise<SeasonImportInput[]> {
  const seasons: SeasonImportInput[] = [];

  for (const seasonNumber of seasonNumbers) {
    const details = await getSeasonDetails(tmdbId, seasonNumber);
    seasons.push({
      seasonNumber,
      title: details.title,
      synopsis: details.synopsis,
      releaseYear: null,
      episodes: details.episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        synopsis: episode.synopsis,
        durationInMinutes: episode.durationInMinutes,
      })),
    });
  }

  return seasons;
}

export async function createSeries(input: SeriesFormInput) {
  const [slug, genres, seasons, images] = await Promise.all([
    generateUniqueSlug(input.title, async (candidate) =>
      Boolean(await findSeriesBySlug(candidate)),
    ),
    upsertGenresByName(input.genreNames),
    input.tmdbId
      ? importSeasonsFromTmdb(input.tmdbId, input.tmdbSeasonNumbers ?? [])
      : Promise.resolve([]),
    // Best effort: a TMDB hiccup must not block creating the series itself.
    input.tmdbId ? fetchSeriesImages(input.tmdbId).catch(() => null) : null,
  ]);

  const series = await createSeriesWithSeasons({
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    slug,
    genreIds: genres.map((genre) => genre.id),
    seasons,
  });

  if (images) {
    await setSeriesImages(series.id, images);
  }
  return series;
}

export async function updateSeries(
  id: string,
  input: UpdateSeriesFormInput,
): Promise<void> {
  const current = await getSeriesForAdmin(id);

  const nextSlug = slugify(input.slug);
  if (nextSlug !== current.slug) {
    const collision = await findSeriesBySlug(nextSlug);
    if (collision && collision.id !== id) {
      throw new SlugAlreadyInUseError();
    }
  }

  const genres = await upsertGenresByName(input.genreNames);

  await updateSeriesRecord(id, {
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    slug: nextSlug,
    genreIds: genres.map((genre) => genre.id),
  });
}

export async function setSeriesActive(id: string, isActive: boolean): Promise<void> {
  await setSeriesActiveRecord(id, isActive);
}

/**
 * Links episodes of one series to files on a video source. As with movies, the
 * client only names files; URLs come from the source's own listing. Episode ids
 * are checked against the series so one series can never rewrite another.
 */
export async function assignEpisodeVideos(
  seriesId: string,
  input: AssignEpisodeVideosInput,
): Promise<number> {
  await getSeriesForAdmin(seriesId);

  const provider = getVideoSourceProvider(input.provider);
  if (!provider) {
    throw new VideoSourceError("Fonte de vídeo desconhecida.");
  }

  const [files, validEpisodeIds] = await Promise.all([
    provider.listFiles(input.itemId),
    findEpisodeIdsOfSeries(seriesId),
  ]);
  const filesByName = new Map(files.map((file) => [file.fileName, file]));

  const items = input.assignments.map(({ episodeId, fileName }) => {
    const file = filesByName.get(fileName);
    if (!validEpisodeIds.has(episodeId) || !file) {
      throw new VideoSourceError("Episódio ou arquivo inválido. Recarregue a página.");
    }
    return {
      episodeId,
      video: {
        storageProvider: provider.storageProvider,
        storageKey: `${input.itemId}/${file.fileName}`,
        url: file.url,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeInBytes: file.sizeInBytes,
        durationInSeconds: file.durationInSeconds,
      },
    };
  });

  await setEpisodeVideos(items);
  return items.length;
}

export async function removeEpisodeVideo(
  seriesId: string,
  episodeId: string,
): Promise<void> {
  const removed = await clearEpisodeVideo(seriesId, episodeId);
  if (!removed) {
    throw new VideoSourceError("Episódio não encontrado nesta série.");
  }
}

/** Pulls the poster and backdrop of a TMDB title onto an existing series. */
export async function applySeriesImages(seriesId: string, tmdbId: number): Promise<void> {
  await getSeriesForAdmin(seriesId);
  await setSeriesImages(seriesId, await fetchSeriesImages(tmdbId));
}
