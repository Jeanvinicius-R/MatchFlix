import { z } from "zod";

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

// tmdbId/tmdbSeasonNumbers only exist on create — set from TmdbSearchPicker state, not
// rendered as inputs — and tell createSeriesAction whether/what to import from TMDB.
export const seriesFormSchema = z.object({
  ...seriesScalarFields,
  tmdbId: z.number().int().positive().optional(),
  tmdbSeasonNumbers: z.array(z.number().int().positive()).optional(),
});

// Edit is series-level only (see README limitation) — no tmdbId/tmdbSeasonNumbers.
export const updateSeriesFormSchema = z.object({
  ...seriesScalarFields,
  slug: z
    .string()
    .trim()
    .min(1, "Informe um slug.")
    .regex(SLUG_PATTERN, "Slug inválido."),
});

export type SeriesFormInput = z.infer<typeof seriesFormSchema>;
export type UpdateSeriesFormInput = z.infer<typeof updateSeriesFormSchema>;
