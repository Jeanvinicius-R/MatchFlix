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

// Edit is series-level only (see README limitation) — no tmdbSeasonNumbers. tmdbId can be
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
