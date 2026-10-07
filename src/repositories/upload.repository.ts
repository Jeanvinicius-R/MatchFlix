import type { MediaType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { removeStoredFiles } from "@/lib/storage/local-storage";
import { deleteMediaIfPresent } from "@/repositories/media.repository";

/** A single Media reference on one row: e.g. a movie's poster, an episode's video. */
export type MediaSlot =
  | { model: "movie"; id: string; field: "posterMediaId" | "backdropMediaId" | "videoMediaId" }
  | { model: "series"; id: string; field: "posterMediaId" | "backdropMediaId" }
  | { model: "episode"; id: string; field: "videoMediaId" }
  | { model: "profile"; id: string; field: "avatarMediaId" };

export interface StoredMediaInput {
  storageKey: string;
  url: string;
  mimeType: string;
  sizeInBytes: number;
  fileName: string | null;
}

const MEDIA_TYPE_BY_FIELD: Record<MediaSlot["field"], MediaType> = {
  posterMediaId: "POSTER",
  backdropMediaId: "BACKDROP",
  videoMediaId: "VIDEO",
  avatarMediaId: "AVATAR",
};

/** Current media id in the slot, or undefined when the row itself does not exist. */
async function readSlot(
  tx: Prisma.TransactionClient,
  slot: MediaSlot,
): Promise<string | null | undefined> {
  switch (slot.model) {
    case "movie": {
      const row = await tx.movie.findUnique({ where: { id: slot.id } });
      return row ? row[slot.field] : undefined;
    }
    case "series": {
      const row = await tx.series.findUnique({ where: { id: slot.id } });
      return row ? row[slot.field] : undefined;
    }
    case "episode": {
      const row = await tx.episode.findUnique({ where: { id: slot.id } });
      return row ? row[slot.field] : undefined;
    }
    case "profile": {
      const row = await tx.profile.findUnique({ where: { id: slot.id } });
      return row ? row[slot.field] : undefined;
    }
  }
}

async function writeSlot(
  tx: Prisma.TransactionClient,
  slot: MediaSlot,
  mediaId: string | null,
): Promise<void> {
  switch (slot.model) {
    case "movie":
      await tx.movie.update({ where: { id: slot.id }, data: { [slot.field]: mediaId } });
      return;
    case "series":
      await tx.series.update({ where: { id: slot.id }, data: { [slot.field]: mediaId } });
      return;
    case "episode":
      await tx.episode.update({ where: { id: slot.id }, data: { [slot.field]: mediaId } });
      return;
    case "profile":
      await tx.profile.update({ where: { id: slot.id }, data: { [slot.field]: mediaId } });
      return;
  }
}

/**
 * Points the slot at a new LOCAL Media row and drops the previous one
 * (removing its file after commit when it was LOCAL too). Returns false when
 * the owning row does not exist.
 */
export async function replaceSlotWithStoredMedia(
  slot: MediaSlot,
  media: StoredMediaInput,
): Promise<boolean> {
  const orphans: (string | null)[] = [];
  const found = await prisma.$transaction(async (tx) => {
    const current = await readSlot(tx, slot);
    if (current === undefined) {
      return false;
    }
    const created = await tx.media.create({
      data: {
        type: MEDIA_TYPE_BY_FIELD[slot.field],
        storageProvider: "LOCAL",
        ...media,
      },
      select: { id: true },
    });
    await writeSlot(tx, slot, created.id);
    orphans.push(await deleteMediaIfPresent(tx, current));
    return true;
  });
  await removeStoredFiles(orphans);
  return found;
}

/** Empties the slot. Returns false when the owning row does not exist. */
export async function clearSlot(slot: MediaSlot): Promise<boolean> {
  const orphans: (string | null)[] = [];
  const found = await prisma.$transaction(async (tx) => {
    const current = await readSlot(tx, slot);
    if (current === undefined) {
      return false;
    }
    await writeSlot(tx, slot, null);
    orphans.push(await deleteMediaIfPresent(tx, current));
    return true;
  });
  await removeStoredFiles(orphans);
  return found;
}

export async function findEpisodeSeriesId(episodeId: string): Promise<string | null> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { season: { select: { seriesId: true } } },
  });
  return episode?.season.seriesId ?? null;
}
