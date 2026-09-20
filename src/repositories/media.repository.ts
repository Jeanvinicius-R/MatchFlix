import type { StorageProvider } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/** A playable file on a remote video source. Nothing is stored locally. */
export interface VideoMediaInput {
  storageProvider: StorageProvider;
  storageKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeInBytes: number | null;
  durationInSeconds: number | null;
}

export async function createVideoMedia(
  tx: Prisma.TransactionClient,
  video: VideoMediaInput,
): Promise<string> {
  const media = await tx.media.create({
    data: { type: "VIDEO", ...video },
    select: { id: true },
  });
  return media.id;
}

export async function deleteMediaIfPresent(
  tx: Prisma.TransactionClient,
  mediaId: string | null | undefined,
): Promise<void> {
  if (mediaId) {
    await tx.media.delete({ where: { id: mediaId } });
  }
}

export interface ImageUrls {
  posterUrl?: string | null;
  backdropUrl?: string | null;
}

/** A remote TMDB image. Only the URL is kept; nothing is downloaded. */
export async function createImageMedia(
  tx: Prisma.TransactionClient,
  type: "POSTER" | "BACKDROP",
  url: string,
): Promise<string> {
  const media = await tx.media.create({
    data: {
      type,
      storageProvider: "TMDB",
      storageKey: new URL(url).pathname,
      url,
    },
    select: { id: true },
  });
  return media.id;
}
