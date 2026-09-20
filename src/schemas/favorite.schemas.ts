import { z } from "zod";

export const toggleFavoriteSchema = z.object({
  kind: z.enum(["movie", "series"]),
  contentId: z.uuid(),
});

export type ToggleFavoriteInput = z.infer<typeof toggleFavoriteSchema>;
