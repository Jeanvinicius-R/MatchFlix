import { z } from "zod";

export const createProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe um nome.")
    .max(30, "O nome pode ter no máximo 30 caracteres."),
  isKids: z.boolean(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
