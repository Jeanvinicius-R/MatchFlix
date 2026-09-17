"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { movieFormSchema, updateMovieFormSchema } from "@/schemas/movie.schemas";
import { createMovie, setMovieActive, updateMovie } from "@/services/movie.service";
import { SlugAlreadyInUseError } from "@/utils/slug.utils";

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

  await createMovie(parsedInput.data);
  redirect("/admin/movies");
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
    throw error;
  }

  redirect("/admin/movies");
}

export async function toggleMovieActiveAction(
  id: string,
  nextIsActive: boolean,
): Promise<void> {
  await requireAdmin();
  await setMovieActive(id, nextIsActive);
  revalidatePath("/admin/movies");
}
