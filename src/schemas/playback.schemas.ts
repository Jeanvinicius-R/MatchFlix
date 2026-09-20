import { z } from "zod";

const target = {
  kind: z.enum(["movie", "episode"]),
  contentId: z.uuid(),
};

export const watchStartSchema = z.object(target);

export const saveProgressSchema = z.object({
  ...target,
  positionInSeconds: z
    .number()
    .min(0)
    .max(60 * 60 * 24),
  durationInSeconds: z
    .number()
    .positive()
    .max(60 * 60 * 24),
});

export type WatchStartInput = z.infer<typeof watchStartSchema>;
export type SaveProgressInput = z.infer<typeof saveProgressSchema>;
