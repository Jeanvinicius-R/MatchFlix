"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { movieFormSchema, updateMovieFormSchema } from "@/schemas/movie.schemas";
import { applyImagesSchema } from "@/schemas/content-images.schemas";
import { attachVideoSchema } from "@/schemas/video-source.schemas";
import { ImageSourceError } from "@/services/content-images.service";
import {
  linkLibraryFilesToMovies,
  type LibraryLinkReport,
} from "@/services/library.service";
import {
  applyMovieImages,
  attachVideoToMovie,
  createMovie,
  MovieNotFoundError,
  removeMovieVideo,
  setMovieActive,
  updateMovie,
} from "@/services/movie.service";
import { VideoSourceError } from "@/services/video-sources/video-source.errors";
import { SlugAlreadyInUseError } from "@/utils/slug.utils";
import { TmdbIdAlreadyInUseError } from "@/utils/tmdb-id.utils";

export interface MovieActionState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function createMovieAction(input: unknown): Promise<MovieActionState> {
  await requireAdmin();
  const parsedInput = movieFormSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  let movie;
  try {
    movie = await createMovie(parsedInput.data);
  } catch (error) {
    if (error instanceof TmdbIdAlreadyInUseError) {
      return { fieldErrors: { tmdbId: [error.message] } };
    }
    throw error;
  }
  redirect(`/admin/movies/${movie.id}/edit`);
}

export async function updateMovieAction(
  id: string,
  input: unknown,
): Promise<MovieActionState> {
  await requireAdmin();
  const parsedInput = updateMovieFormSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await updateMovie(id, parsedInput.data);
  } catch (error) {
    if (error instanceof SlugAlreadyInUseError) {
      return { fieldErrors: { slug: [error.message] } };
    }
    if (error instanceof TmdbIdAlreadyInUseError) {
      return { fieldErrors: { tmdbId: [error.message] } };
    }
    throw error;
  }

  redirect("/admin/movies");
}

export async function attachMovieVideoAction(
  movieId: string,
  input: unknown,
): Promise<MovieActionState & { saved?: boolean }> {
  await requireAdmin();
  const parsedInput = attachVideoSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await attachVideoToMovie(movieId, parsedInput.data);
  } catch (error) {
    if (error instanceof VideoSourceError || error instanceof MovieNotFoundError) {
      return { formError: error.message };
    }
    return { formError: "Não foi possível consultar a fonte de vídeo. Tente novamente." };
  }

  revalidatePath(`/admin/movies/${movieId}/edit`);
  return { saved: true };
}

export async function applyMovieImagesAction(
  movieId: string,
  input: unknown,
): Promise<MovieActionState & { saved?: boolean }> {
  await requireAdmin();
  const parsedInput = applyImagesSchema.safeParse(input);
  if (!parsedInput.success) {
    return { formError: "Selecione um título da TMDB." };
  }

  try {
    await applyMovieImages(movieId, parsedInput.data.tmdbId);
  } catch (error) {
    if (error instanceof ImageSourceError || error instanceof MovieNotFoundError) {
      return { formError: error.message };
    }
    throw error;
  }

  revalidatePath(`/admin/movies/${movieId}/edit`);
  revalidatePath("/");
  return { saved: true };
}

export async function removeMovieVideoAction(movieId: string): Promise<void> {
  await requireAdmin();
  await removeMovieVideo(movieId);
  revalidatePath(`/admin/movies/${movieId}/edit`);
}

export async function toggleMovieActiveAction(
  id: string,
  nextIsActive: boolean,
): Promise<void> {
  await requireAdmin();
  await setMovieActive(id, nextIsActive);
  revalidatePath("/admin/movies");
}

export interface LibraryLinkActionResult {
  report?: LibraryLinkReport;
  formError?: string;
}

export async function linkLibraryFilesAction(): Promise<LibraryLinkActionResult> {
  await requireAdmin();
  try {
    const report = await linkLibraryFilesToMovies();
    revalidatePath("/admin/movies");
    revalidatePath("/");
    return { report };
  } catch {
    return {
      formError:
        "Não foi possível ler a pasta de filmes. Confira MEDIA_LIBRARY_DIR no .env.",
    };
  }
}
