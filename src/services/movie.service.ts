import {
  clearMovieVideo,
  createMovie as createMovieRecord,
  findAllMoviesForAdmin,
  findMovieByIdForAdmin,
  findMovieBySlug,
  findMovieByTmdbId,
  findMovieForPlaybackBySlug,
  setMovieActive as setMovieActiveRecord,
  setMovieImages,
  setMovieVideo,
  updateMovie as updateMovieRecord,
} from "@/repositories/movie.repository";
import { upsertGenresByName } from "@/services/genre.service";
import type { MovieFormInput, UpdateMovieFormInput } from "@/schemas/movie.schemas";
import type { AttachVideoInput } from "@/schemas/video-source.schemas";
import { fetchMovieImages } from "@/services/content-images.service";
import { getVideoSourceProvider } from "@/services/video-sources";
import { VideoSourceError } from "@/services/video-sources/video-source.errors";
import { mapAgeRatingLabelToEnum } from "@/utils/age-rating.utils";
import { generateUniqueSlug, slugify, SlugAlreadyInUseError } from "@/utils/slug.utils";
import { TmdbIdAlreadyInUseError } from "@/utils/tmdb-id.utils";

export class MovieNotFoundError extends Error {
  constructor() {
    super("Filme não encontrado.");
    this.name = "MovieNotFoundError";
  }
}

export function listMoviesForAdmin() {
  return findAllMoviesForAdmin();
}

export async function getMovieForAdmin(id: string) {
  const movie = await findMovieByIdForAdmin(id);
  if (!movie) {
    throw new MovieNotFoundError();
  }
  return movie;
}

async function assertTmdbIdAvailable(tmdbId: number | undefined, movieId?: string) {
  if (!tmdbId) {
    return;
  }
  const owner = await findMovieByTmdbId(tmdbId);
  if (owner && owner.id !== movieId) {
    throw new TmdbIdAlreadyInUseError();
  }
}

export async function createMovie(input: MovieFormInput) {
  await assertTmdbIdAvailable(input.tmdbId);

  const [slug, genres, images] = await Promise.all([
    generateUniqueSlug(input.title, async (candidate) =>
      Boolean(await findMovieBySlug(candidate)),
    ),
    upsertGenresByName(input.genreNames),
    // Best effort: a TMDB hiccup must not block creating the movie itself.
    input.tmdbId ? fetchMovieImages(input.tmdbId).catch(() => null) : null,
  ]);

  const movie = await createMovieRecord({
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    durationInMinutes: input.durationInMinutes,
    tmdbId: input.tmdbId ?? null,
    slug,
    genreIds: genres.map((genre) => genre.id),
  });

  if (images) {
    await setMovieImages(movie.id, images);
  }
  return movie;
}

export async function updateMovie(
  id: string,
  input: UpdateMovieFormInput,
): Promise<void> {
  const current = await getMovieForAdmin(id);

  const nextSlug = slugify(input.slug);
  if (nextSlug !== current.slug) {
    const collision = await findMovieBySlug(nextSlug);
    if (collision && collision.id !== id) {
      throw new SlugAlreadyInUseError();
    }
  }

  await assertTmdbIdAvailable(input.tmdbId, id);

  const genres = await upsertGenresByName(input.genreNames);

  await updateMovieRecord(id, {
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    durationInMinutes: input.durationInMinutes,
    tmdbId: input.tmdbId ?? undefined,
    slug: nextSlug,
    genreIds: genres.map((genre) => genre.id),
  });
}

export async function setMovieActive(id: string, isActive: boolean): Promise<void> {
  await setMovieActiveRecord(id, isActive);
}

/**
 * Links a movie to a file on a video source. The client only names the file;
 * the URL is rebuilt here from the source's own file list, so a forged
 * request can never store an arbitrary URL.
 */
export async function attachVideoToMovie(
  movieId: string,
  input: AttachVideoInput,
): Promise<void> {
  await getMovieForAdmin(movieId);

  const provider = getVideoSourceProvider(input.provider);
  if (!provider) {
    throw new VideoSourceError("Fonte de vídeo desconhecida.");
  }

  const files = await provider.listFiles(input.itemId);
  const file = files.find((candidate) => candidate.fileName === input.fileName);
  if (!file) {
    throw new VideoSourceError("Arquivo não encontrado nessa fonte.");
  }

  await setMovieVideo(movieId, {
    storageProvider: provider.storageProvider,
    storageKey: `${input.itemId}/${file.fileName}`,
    url: file.url,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeInBytes: file.sizeInBytes,
    durationInSeconds: file.durationInSeconds,
  });
}

/** Pulls the poster and backdrop of a TMDB title onto an existing movie. */
export async function applyMovieImages(movieId: string, tmdbId: number): Promise<void> {
  await getMovieForAdmin(movieId);
  await setMovieImages(movieId, await fetchMovieImages(tmdbId));
}

export async function removeMovieVideo(movieId: string): Promise<void> {
  await getMovieForAdmin(movieId);
  await clearMovieVideo(movieId);
}

/** Returns null when the movie is missing, inactive or off-limits for a kids profile. */
export async function getMovieForPlayback(slug: string, kidsOnly: boolean) {
  const movie = await findMovieForPlaybackBySlug(slug);
  if (!movie || !movie.isActive || (kidsOnly && movie.ageRating !== "L")) {
    return null;
  }
  return movie;
}
