import { z } from "zod";
import { optionalTmdbIdSchema } from "@/schemas/tmdb-id.schemas";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const seriesScalarFields = {
  title: z
    .string()
    .trim()
    .min(1, "Informe um título.")
    .max(200, "Máximo de 200 caracteres."),
  originalTitle: z
    .string()
    .trim()
    .max(200, "Máximo de 200 caracteres.")
    .optional()
    .or(z.literal("")),
  synopsis: z
    .string()
    .trim()
    .min(1, "Informe uma sinopse.")
    .max(2000, "Máximo de 2000 caracteres."),
  releaseYear: z.coerce
    .number()
    .int()
    .min(1888, "Ano inválido.")
    .max(2100, "Ano inválido."),
  ageRating: z.enum(["L", "10", "12", "14", "16", "18"], "Selecione uma classificação."),
  genreNames: z.array(z.string().trim().min(1)).min(1, "Selecione ao menos um gênero."),
};

// tmdbSeasonNumbers only exists on create — set from TmdbSearchPicker state, not rendered
// as an input — and tells createSeriesAction which seasons to import from TMDB.
export const seriesFormSchema = z.object({
  ...seriesScalarFields,
  tmdbId: optionalTmdbIdSchema,
  tmdbSeasonNumbers: z.array(z.number().int().positive()).optional(),
});

// The series form edits series-level fields only — seasons have their own actions below. tmdbId can be
// set/changed here; leaving it empty keeps the stored value.
export const updateSeriesFormSchema = z.object({
  ...seriesScalarFields,
  tmdbId: optionalTmdbIdSchema,
  slug: z
    .string()
    .trim()
    .min(1, "Informe um slug.")
    .regex(SLUG_PATTERN, "Slug inválido."),
});

export type SeriesFormInput = z.infer<typeof seriesFormSchema>;
export type UpdateSeriesFormInput = z.infer<typeof updateSeriesFormSchema>;

// --- Seasons/episodes management on an existing series (admin) ---

export const syncSeasonsSchema = z.object({
  seasonNumbers: z
    .array(z.number().int().min(0).max(1000))
    .min(1, "Escolha ao menos uma temporada.")
    .max(100),
  updateExisting: z.boolean(),
});
export type SyncSeasonsInput = z.infer<typeof syncSeasonsSchema>;

export const addSeasonSchema = z.object({
  seasonNumber: z.coerce.number().int().min(0, "Número inválido.").max(1000, "Número inválido."),
  title: z.string().trim().max(200, "Máximo de 200 caracteres.").optional().or(z.literal("")),
});
export type AddSeasonInput = z.infer<typeof addSeasonSchema>;

const episodeTextFields = {
  title: z.string().trim().min(1, "Informe um título.").max(200, "Máximo de 200 caracteres."),
  synopsis: z.string().trim().max(2000, "Máximo de 2000 caracteres.").optional().or(z.literal("")),
  durationInMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(1, "Duração inválida.").max(1000)])
    .optional(),
};

export const addEpisodeSchema = z.object({
  seasonId: z.uuid(),
  episodeNumber: z.coerce.number().int().min(1, "Número inválido.").max(10000),
  ...episodeTextFields,
});
export type AddEpisodeInput = z.infer<typeof addEpisodeSchema>;

export const updateEpisodeSchema = z.object({
  episodeId: z.uuid(),
  ...episodeTextFields,
});
export type UpdateEpisodeInput = z.infer<typeof updateEpisodeSchema>;
