import { z } from "zod";

// String literals mirror the Prisma enums on purpose: this module (and the tests
// that import it) must not depend on the generated client at runtime.
export const MATCH_METHODS = ["TMDB_ID", "IMDB_ID", "METADATA"] as const;
export const CANDIDATE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type MatchMethodValue = (typeof MATCH_METHODS)[number];
export type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];

/** Shortest license/contract reference an administrator may approve with. */
export const MIN_LICENSE_REFERENCE_LENGTH = 10;

const candidateIdsSchema = z
  .array(z.uuid("Candidato inválido."))
  .min(1, "Selecione ao menos um candidato.")
  .max(200, "Selecione no máximo 200 candidatos por vez.");

export const approveCandidatesSchema = z.object({
  ids: candidateIdsSchema,
  licenseReference: z
    .string()
    .trim()
    .min(
      MIN_LICENSE_REFERENCE_LENGTH,
      `Informe a licença ou o contrato (mínimo de ${MIN_LICENSE_REFERENCE_LENGTH} caracteres).`,
    )
    .max(500, "Máximo de 500 caracteres."),
  // Required (and only honored) when approving ONE weak, metadata-only suggestion.
  acknowledgeMetadataMatch: z.boolean().optional(),
  // Required (true) when approving more than one candidate at once: the
  // administrator confirms the license/contract really covers EVERY selected title.
  licenseCoversAllSelected: z.boolean().optional(),
});

export type ApproveCandidatesInput = z.infer<typeof approveCandidatesSchema>;

export const rejectSchema = z.object({
  ids: candidateIdsSchema,
});

export type RejectCandidatesInput = z.infer<typeof rejectSchema>;

export const syncSchema = z.object({
  providerId: z.string().trim().min(1, "Selecione um provedor."),
  limit: z
    .number("Limite inválido.")
    .int("Limite inválido.")
    .min(1, "Limite inválido.")
    .max(200, "Limite máximo: 200.")
    .optional(),
});

export type SyncInput = z.infer<typeof syncSchema>;
