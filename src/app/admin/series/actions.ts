"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z, type ZodType } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import {
  addEpisodeSchema,
  addSeasonSchema,
  seriesFormSchema,
  syncSeasonsSchema,
  updateEpisodeSchema,
  updateSeriesFormSchema,
} from "@/schemas/series.schemas";
import { applyImagesSchema } from "@/schemas/content-images.schemas";
import { assignEpisodeVideosSchema } from "@/schemas/video-source.schemas";
import { ImageSourceError } from "@/services/content-images.service";
import {
  addEpisode,
  addSeason,
  applySeriesImages,
  assignEpisodeVideos,
  createSeries,
  editEpisode,
  removeEpisodeVideo,
  SeasonManagementError,
  SeriesNotFoundError,
  setSeriesActive,
  syncSeasonsFromTmdb,
  updateSeries,
} from "@/services/series.service";
import { VideoSourceError } from "@/services/video-sources/video-source.errors";
import { SlugAlreadyInUseError } from "@/utils/slug.utils";
import { TmdbIdAlreadyInUseError } from "@/utils/tmdb-id.utils";

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

  let series;
  try {
    series = await createSeries(parsedInput.data);
  } catch (error) {
    if (error instanceof TmdbIdAlreadyInUseError) {
      return { fieldErrors: { tmdbId: [error.message] } };
    }
    throw error;
  }
  redirect(`/admin/series/${series.id}/edit`);
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
    if (error instanceof TmdbIdAlreadyInUseError) {
      return { fieldErrors: { tmdbId: [error.message] } };
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

export interface SeasonActionState extends SeriesActionState {
  message?: string;
}

/** Shared shape for the season/episode actions: validate, run, revalidate, report. */
async function runSeasonAction<T>(
  seriesId: string,
  schema: ZodType<T>,
  input: unknown,
  run: (data: T) => Promise<string>,
): Promise<SeasonActionState> {
  await requireAdmin();
  const parsedInput = schema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: z.flattenError(parsedInput.error).fieldErrors as Record<string, string[]> };
  }
  try {
    const message = await run(parsedInput.data);
    revalidatePath(`/admin/series/${seriesId}/edit`);
    return { message };
  } catch (error) {
    if (error instanceof SeasonManagementError || error instanceof SeriesNotFoundError) {
      return { formError: error.message };
    }
    throw error;
  }
}

export async function syncSeasonsAction(
  seriesId: string,
  input: unknown,
): Promise<SeasonActionState> {
  return runSeasonAction(seriesId, syncSeasonsSchema, input, async (data) => {
    const report = await syncSeasonsFromTmdb(seriesId, data);
    return (
      `${report.seasonsCreated} temporada(s) e ${report.episodesCreated} episódio(s) criados` +
      (data.updateExisting
        ? `; ${report.seasonsUpdated} temporada(s) e ${report.episodesUpdated} episódio(s) atualizados.`
        : ".")
    );
  });
}

export async function addSeasonAction(
  seriesId: string,
  input: unknown,
): Promise<SeasonActionState> {
  return runSeasonAction(seriesId, addSeasonSchema, input, async (data) => {
    await addSeason(seriesId, data);
    return `Temporada ${data.seasonNumber} adicionada.`;
  });
}

export async function addEpisodeAction(
  seriesId: string,
  input: unknown,
): Promise<SeasonActionState> {
  return runSeasonAction(seriesId, addEpisodeSchema, input, async (data) => {
    await addEpisode(seriesId, data);
    return `Episódio ${data.episodeNumber} adicionado.`;
  });
}

export async function updateEpisodeAction(
  seriesId: string,
  input: unknown,
): Promise<SeasonActionState> {
  return runSeasonAction(seriesId, updateEpisodeSchema, input, async (data) => {
    await editEpisode(seriesId, data);
    return "Episódio atualizado.";
  });
}

export async function toggleSeriesActiveAction(
  id: string,
  nextIsActive: boolean,
): Promise<void> {
  await requireAdmin();
  await setSeriesActive(id, nextIsActive);
  revalidatePath("/admin/series");
}
