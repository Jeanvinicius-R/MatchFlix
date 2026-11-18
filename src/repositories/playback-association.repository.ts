import { prisma } from "@/lib/prisma";
import type {
  AssociationMediaTypeValue,
  AvailabilityStatusValue,
  PlaybackFormatValue,
  RightsStatusValue,
} from "@/schemas/playback-association.schemas";

const ASSOCIATION_SELECT = {
  id: true,
  tmdbId: true,
  mediaType: true,
  seasonNumber: true,
  episodeNumber: true,
  provider: true,
  providerAssetId: true,
  playbackType: true,
  rightsStatus: true,
  licenseReference: true,
  availabilityStatus: true,
  lastVerifiedAt: true,
  createdAt: true,
} as const;

export interface PlayableCandidateQuery {
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  provider: string;
}

export interface NewAssociationRecord {
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  provider: string;
  providerAssetId: string;
  playbackType: PlaybackFormatValue | null;
  rightsStatus: RightsStatusValue;
  licenseReference: string | null;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as { code?: string } | null)?.code === code;
}

/**
 * What the player may use: only rights decided as VERIFIED by an admin, and
 * not flagged unavailable by the last check. Oldest association first.
 */
export function findPlayableCandidates(query: PlayableCandidateQuery) {
  return prisma.playbackAssociation.findMany({
    where: {
      tmdbId: query.tmdbId,
      mediaType: query.mediaType,
      seasonNumber: query.seasonNumber,
      episodeNumber: query.episodeNumber,
      provider: query.provider,
      rightsStatus: "VERIFIED",
      availabilityStatus: { not: "UNAVAILABLE" },
    },
    orderBy: { createdAt: "asc" },
    select: ASSOCIATION_SELECT,
  });
}

/** Most recent first. */
export function listAssociationRecords() {
  return prisma.playbackAssociation.findMany({
    orderBy: { createdAt: "desc" },
    select: ASSOCIATION_SELECT,
  });
}

export function findAssociationById(id: string) {
  return prisma.playbackAssociation.findUnique({
    where: { id },
    select: ASSOCIATION_SELECT,
  });
}

/** Null when the (title, provider, asset) triple is already registered (P2002). */
export async function createAssociationRecord(data: NewAssociationRecord) {
  try {
    return await prisma.playbackAssociation.create({
      data,
      select: ASSOCIATION_SELECT,
    });
  } catch (error) {
    if (hasErrorCode(error, "P2002")) {
      return null;
    }
    throw error;
  }
}

/** `licenseReference: undefined` keeps the stored value. Null when the id does not exist. */
export async function updateAssociationRights(
  id: string,
  data: { rightsStatus: RightsStatusValue; licenseReference?: string | null },
) {
  try {
    return await prisma.playbackAssociation.update({
      where: { id },
      data,
      select: ASSOCIATION_SELECT,
    });
  } catch (error) {
    if (hasErrorCode(error, "P2025")) {
      return null;
    }
    throw error;
  }
}

export async function updateAssociationAvailability(
  id: string,
  availabilityStatus: AvailabilityStatusValue,
  lastVerifiedAt: Date,
): Promise<void> {
  try {
    await prisma.playbackAssociation.update({
      where: { id },
      data: { availabilityStatus, lastVerifiedAt },
    });
  } catch (error) {
    // Deleted while the check was running: nothing left to update.
    if (!hasErrorCode(error, "P2025")) {
      throw error;
    }
  }
}

/** False when the id did not exist. */
export async function deleteAssociationRecord(id: string): Promise<boolean> {
  try {
    await prisma.playbackAssociation.delete({ where: { id } });
    return true;
  } catch (error) {
    if (hasErrorCode(error, "P2025")) {
      return false;
    }
    throw error;
  }
}

/**
 * TMDB ids that have at least one VERIFIED, not-unavailable association —
 * for "is it playable?" badges without calling any remote provider.
 * For EPISODE rows the id is the series' id.
 */
export async function findVerifiedTmdbIds(
  mediaType: AssociationMediaTypeValue,
): Promise<number[]> {
  const rows = await prisma.playbackAssociation.findMany({
    where: {
      mediaType,
      rightsStatus: "VERIFIED",
      availabilityStatus: { not: "UNAVAILABLE" },
    },
    distinct: ["tmdbId"],
    select: { tmdbId: true },
  });

  return rows.map((row) => row.tmdbId);
}
