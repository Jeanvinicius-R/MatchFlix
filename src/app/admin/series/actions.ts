"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { seriesFormSchema, updateSeriesFormSchema } from "@/schemas/series.schemas";
import { createSeries, setSeriesActive, updateSeries } from "@/services/series.service";
import { SlugAlreadyInUseError } from "@/utils/slug.utils";

export interface SeriesActionState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function createSeriesAction(input: unknown): Promise<SeriesActionState> {
  await requireAdmin();
  const parsedInput = seriesFormSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  await createSeries(parsedInput.data);
  redirect("/admin/series");
}

export async function updateSeriesAction(
  id: string,
  input: unknown,
): Promise<SeriesActionState> {
  await requireAdmin();
  const parsedInput = updateSeriesFormSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await updateSeries(id, parsedInput.data);
  } catch (error) {
    if (error instanceof SlugAlreadyInUseError) {
      return { fieldErrors: { slug: [error.message] } };
    }
    throw error;
  }

  redirect("/admin/series");
}

export async function toggleSeriesActiveAction(
  id: string,
  nextIsActive: boolean,
): Promise<void> {
  await requireAdmin();
  await setSeriesActive(id, nextIsActive);
  revalidatePath("/admin/series");
}
