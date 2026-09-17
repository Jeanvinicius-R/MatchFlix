"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { genreFormSchema } from "@/schemas/genre.schemas";
import { createGenre, deleteGenre, updateGenre } from "@/services/genre.service";
import { SlugAlreadyInUseError } from "@/utils/slug.utils";

export interface GenreActionState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function createGenreAction(input: unknown): Promise<GenreActionState> {
  await requireAdmin();
  const parsedInput = genreFormSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  await createGenre(parsedInput.data);
  revalidatePath("/admin/genres");
  return {};
}

export async function updateGenreAction(
  id: string,
  input: unknown,
): Promise<GenreActionState> {
  await requireAdmin();
  const parsedInput = genreFormSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await updateGenre(id, parsedInput.data);
  } catch (error) {
    if (error instanceof SlugAlreadyInUseError) {
      return { fieldErrors: { name: [error.message] } };
    }
    throw error;
  }

  revalidatePath("/admin/genres");
  return {};
}

export async function deleteGenreAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteGenre(id);
  revalidatePath("/admin/genres");
}
