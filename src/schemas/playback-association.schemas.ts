import { z } from "zod";

// String literals mirror the Prisma enums on purpose: this module (and the tests
// that import it) must not depend on the generated client at runtime.
export const ASSOCIATION_MEDIA_TYPES = ["MOVIE", "EPISODE"] as const;
export const RIGHTS_STATUSES = ["UNVERIFIED", "VERIFIED", "EXPIRED", "REVOKED"] as const;
export const PLAYBACK_FORMATS = ["MP4", "HLS", "DASH", "EMBED"] as const;
export const AVAILABILITY_STATUSES = ["UNKNOWN", "AVAILABLE", "UNAVAILABLE"] as const;

export type AssociationMediaTypeValue = (typeof ASSOCIATION_MEDIA_TYPES)[number];
export type RightsStatusValue = (typeof RIGHTS_STATUSES)[number];
export type PlaybackFormatValue = (typeof PLAYBACK_FORMATS)[number];
export type AvailabilityStatusValue = (typeof AVAILABILITY_STATUSES)[number];

const licenseReferenceSchema = z.string().trim().max(500, "Máximo de 500 caracteres.");

export const createAssociationSchema = z
  .object({
    // For an episode this is the id of the SERIES (TMDB has no episode-level id here).
    tmdbId: z.coerce.number().int("TMDB ID inválido.").positive("TMDB ID inválido."),
    mediaType: z.enum(ASSOCIATION_MEDIA_TYPES, "Selecione o tipo."),
    // Zeros (not NULL) for movies: see the PlaybackAssociation model.
    seasonNumber: z.coerce
      .number()
      .int("Temporada inválida.")
      .min(0, "Temporada inválida.")
      .default(0),
    episodeNumber: z.coerce
      .number()
      .int("Episódio inválido.")
      .min(0, "Episódio inválido.")
      .default(0),
    provider: z.string().trim().min(1, "Selecione um provedor."),
    providerAssetId: z
      .string()
      .trim()
      .min(1, "Informe o identificador no provedor.")
      .max(300, "Máximo de 300 caracteres."),
    playbackType: z.enum(PLAYBACK_FORMATS).optional(),
    licenseReference: licenseReferenceSchema.optional(),
  })
  .refine(
    (value) =>
      value.mediaType !== "MOVIE" || (value.seasonNumber === 0 && value.episodeNumber === 0),
    { message: "Filme não tem temporada nem episódio.", path: ["mediaType"] },
  )
  .refine((value) => value.mediaType !== "EPISODE" || value.episodeNumber >= 1, {
    message: "Informe o número do episódio.",
    path: ["episodeNumber"],
  });

export type CreateAssociationInput = z.infer<typeof createAssociationSchema>;

export const setRightsSchema = z.object({
  id: z.uuid(),
  rightsStatus: z.enum(RIGHTS_STATUSES, "Selecione o status de direitos."),
  licenseReference: licenseReferenceSchema.optional(),
});

export type SetRightsInput = z.infer<typeof setRightsSchema>;
