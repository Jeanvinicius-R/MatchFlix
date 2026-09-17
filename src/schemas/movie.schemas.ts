import { z } from "zod";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const movieFormSchema = z.object({
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
  durationInMinutes: z.coerce
    .number()
    .int()
    .min(1, "Informe a duração em minutos.")
    .max(1000, "Duração inválida."),
  genreNames: z.array(z.string().trim().min(1)).min(1, "Selecione ao menos um gênero."),
});

export const updateMovieFormSchema = movieFormSchema.extend({
  slug: z
    .string()
    .trim()
    .min(1, "Informe um slug.")
    .regex(SLUG_PATTERN, "Slug inválido."),
});

export type MovieFormInput = z.infer<typeof movieFormSchema>;
export type UpdateMovieFormInput = z.infer<typeof updateMovieFormSchema>;
