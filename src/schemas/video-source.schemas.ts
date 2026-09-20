import { z } from "zod";

export const attachVideoSchema = z.object({
  provider: z.string().trim().min(1, "Selecione uma fonte."),
  itemId: z.string().trim().min(1, "Selecione um título.").max(200),
  fileName: z.string().trim().min(1, "Selecione um arquivo.").max(500),
});

export type AttachVideoInput = z.infer<typeof attachVideoSchema>;

const MAX_EPISODES_PER_IMPORT = 500;

export const assignEpisodeVideosSchema = z.object({
  provider: z.string().trim().min(1, "Selecione uma fonte."),
  itemId: z.string().trim().min(1, "Selecione um título.").max(200),
  assignments: z
    .array(
      z.object({
        episodeId: z.uuid(),
        fileName: z.string().trim().min(1).max(500),
      }),
    )
    .min(1, "Associe ao menos um episódio a um arquivo.")
    .max(MAX_EPISODES_PER_IMPORT),
});

export type AssignEpisodeVideosInput = z.infer<typeof assignEpisodeVideosSchema>;
