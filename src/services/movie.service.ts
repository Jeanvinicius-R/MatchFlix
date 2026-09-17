import {
  createMovie as createMovieRecord,
  findAllMoviesForAdmin,
  findMovieByIdForAdmin,
  findMovieBySlug,
  setMovieActive as setMovieActiveRecord,
  updateMovie as updateMovieRecord,
} from "@/repositories/movie.repository";
import { upsertGenresByName } from "@/services/genre.service";
import type { MovieFormInput, UpdateMovieFormInput } from "@/schemas/movie.schemas";
import { mapAgeRatingLabelToEnum } from "@/utils/age-rating.utils";
import { generateUniqueSlug, slugify, SlugAlreadyInUseError } from "@/utils/slug.utils";

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

export async function createMovie(input: MovieFormInput) {
  const [slug, genres] = await Promise.all([
    generateUniqueSlug(input.title, async (candidate) =>
      Boolean(await findMovieBySlug(candidate)),
    ),
    upsertGenresByName(input.genreNames),
  ]);

  return createMovieRecord({
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    durationInMinutes: input.durationInMinutes,
    slug,
    genreIds: genres.map((genre) => genre.id),
  });
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

  const genres = await upsertGenresByName(input.genreNames);

  await updateMovieRecord(id, {
    title: input.title,
    originalTitle: input.originalTitle || null,
    synopsis: input.synopsis,
    releaseYear: input.releaseYear,
    ageRating: mapAgeRatingLabelToEnum(input.ageRating),
    durationInMinutes: input.durationInMinutes,
    slug: nextSlug,
    genreIds: genres.map((genre) => genre.id),
  });
}

export async function setMovieActive(id: string, isActive: boolean): Promise<void> {
  await setMovieActiveRecord(id, isActive);
}
