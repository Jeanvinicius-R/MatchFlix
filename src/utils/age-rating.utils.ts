import { AgeRating as PrismaAgeRating } from "@/generated/prisma/enums";
import type { AgeRating } from "@/types/content.types";

/** Inverse of content.mapper.ts's AGE_RATING_LABELS — admin-only, since that map owns the public read path. */
const AGE_RATING_ENUM_VALUES: Record<AgeRating, PrismaAgeRating> = {
  L: PrismaAgeRating.L,
  "10": PrismaAgeRating.TEN,
  "12": PrismaAgeRating.TWELVE,
  "14": PrismaAgeRating.FOURTEEN,
  "16": PrismaAgeRating.SIXTEEN,
  "18": PrismaAgeRating.EIGHTEEN,
};

export function mapAgeRatingLabelToEnum(label: AgeRating): PrismaAgeRating {
  return AGE_RATING_ENUM_VALUES[label];
}
