import { prisma } from "@/lib/prisma";
import type { PlayableTitleRecord } from "@/services/playback/playable-titles";
import type {
  TitleAssociationRecord,
  TitleQuery,
} from "@/services/playback/title-availability";

/**
 * Read-only queries behind the availability state (NONE / CONFIRMED / UNKNOWN /
 * UNAVAILABLE). Database only: nothing here ever calls a provider.
 */

/** Every VERIFIED association of one title (UNAVAILABLE ones included). */
export function findVerifiedAssociationsForTitle(
  query: TitleQuery,
): Promise<TitleAssociationRecord[]> {
  return prisma.playbackAssociation.findMany({
    where: {
      tmdbId: query.tmdbId,
      mediaType: query.mediaType,
      seasonNumber: query.seasonNumber,
      episodeNumber: query.episodeNumber,
      rightsStatus: "VERIFIED",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      rightsStatus: true,
      availabilityStatus: true,
      lastVerifiedAt: true,
    },
  });
}

/**
 * Every VERIFIED association with the columns the badge needs, for the
 * in-memory "which cards have video" cache. For EPISODE rows `tmdbId` is the
 * series' id.
 */
export function findVerifiedAvailabilityRecords(): Promise<PlayableTitleRecord[]> {
  return prisma.playbackAssociation.findMany({
    where: { rightsStatus: "VERIFIED" },
    select: {
      tmdbId: true,
      mediaType: true,
      rightsStatus: true,
      availabilityStatus: true,
      lastVerifiedAt: true,
    },
  });
}
