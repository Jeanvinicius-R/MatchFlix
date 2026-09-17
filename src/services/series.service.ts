import {
  createSeriesWithSeasons,
  findAllSeriesForAdmin,
  findSeriesByIdForAdmin,
  findSeriesBySlug,
  type SeasonImportInput,
  setSeriesActive as setSeriesActiveRecord,
  updateSeries as updateSeriesRecord,
} from "@/repositories/series.repository";
import { upsertGenresByName } from "@/services/genre.service";
import { getSeasonDetails } from "@/services/tmdb/tmdb.service";
import type { SeriesFormInput, UpdateSeriesFormInput } from "@/schemas/series.schemas";
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
  const [slug, genres, seasons] = await Promise.all([
    generateUniqueSlug(input.title, async (candidate) =>
      Boolean(await findSeriesBySlug(candidate)),
    ),
    upsertGenresByName(input.genreNames),
    input.tmdbId
      ? importSeasonsFromTmdb(input.tmdbId, input.tmdbSeasonNumbers ?? [])
      : Promise.resolve([]),
  ]);

  return createSeriesWithSeasons({
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    slug,
    genreIds: genres.map((genre) => genre.id),
    seasons,
  });
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
