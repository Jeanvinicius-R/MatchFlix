import { z } from "zod";

export const applyImagesSchema = z.object({
  tmdbId: z.number().int().positive(),
});

export type ApplyImagesInput = z.infer<typeof applyImagesSchema>;
