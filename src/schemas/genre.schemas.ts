import { z } from "zod";

export const genreFormSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(50, "Máximo de 50 caracteres."),
});

export type GenreFormInput = z.infer<typeof genreFormSchema>;
