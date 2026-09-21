import { z } from "zod";

/**
 * Optional TMDB id typed by an admin: an empty field means "not informed"
 * (undefined), anything else must be a positive integer.
 */
export const optionalTmdbIdSchema = z.preprocess(
  (value) =>
    value === "" || value === null || (typeof value === "number" && Number.isNaN(value))
      ? undefined
      : value,
  z.coerce
    .number("TMDB ID inválido.")
    .int("TMDB ID inválido.")
    .positive("TMDB ID inválido.")
    .optional(),
);
