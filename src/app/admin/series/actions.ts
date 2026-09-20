"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { seriesFormSchema, updateSeriesFormSchema } from "@/schemas/series.schemas";
import { applyImagesSchema } from "@/schemas/content-images.schemas";
import { assignEpisodeVideosSchema } from "@/schemas/video-source.schemas";
import { ImageSourceError } from "@/services/content-images.service";
import {
  applySeriesImages,
  assignEpisodeVideos,
  createSeries,
  removeEpisodeVideo,
  SeriesNotFoundError,
  setSeriesActive,
  updateSeries,
} from "@/services/series.service";
import { VideoSourceError } from "@/services/video-sources/video-source.errors";
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

export async function assignEpisodeVideosAction(
  seriesId: string,
  input: unknown,
): Promise<SeriesActionState & { savedCount?: number }> {
  await requireAdmin();
  const parsedInput = assignEpisodeVideosSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    const savedCount = await assignEpisodeVideos(seriesId, parsedInput.data);
    revalidatePath(`/admin/series/${seriesId}/edit`);
    return { savedCount };
  } catch (error) {
    if (error instanceof VideoSourceError || error instanceof SeriesNotFoundError) {
      return { formError: error.message };
    }
    return { formError: "Não foi possível consultar a fonte de vídeo. Tente novamente." };
  }
}

export async function applySeriesImagesAction(
  seriesId: string,
  input: unknown,
): Promise<SeriesActionState & { saved?: boolean }> {
  await requireAdmin();
  const parsedInput = applyImagesSchema.safeParse(input);
  if (!parsedInput.success) {
    return { formError: "Selecione um título da TMDB." };
  }

  try {
    await applySeriesImages(seriesId, parsedInput.data.tmdbId);
  } catch (error) {
    if (error instanceof ImageSourceError || error instanceof SeriesNotFoundError) {
      return { formError: error.message };
    }
    throw error;
  }

  revalidatePath(`/admin/series/${seriesId}/edit`);
  revalidatePath("/");
  return { saved: true };
}

export async function removeEpisodeVideoAction(
  seriesId: string,
  episodeId: string,
): Promise<void> {
  await requireAdmin();
  await removeEpisodeVideo(seriesId, episodeId);
  revalidatePath(`/admin/series/${seriesId}/edit`);
}

export async function toggleSeriesActiveAction(
  id: string,
  nextIsActive: boolean,
): Promise<void> {
  await requireAdmin();
  await setSeriesActive(id, nextIsActive);
  revalidatePath("/admin/series");
}
