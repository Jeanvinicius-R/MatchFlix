import {
  IMAGE_KINDS,
  publicUrlForKey,
  removeStoredFiles,
  saveUpload,
  UPLOAD_LIMITS,
  UploadError,
  VIDEO_KINDS,
  type UploadCategory,
  type UploadKind,
} from "@/lib/storage/local-storage";
import { findProfileById } from "@/repositories/profile.repository";
import {
  clearSlot,
  replaceSlotWithStoredMedia,
  type MediaSlot,
} from "@/repositories/upload.repository";

export { UploadError } from "@/lib/storage/local-storage";

export interface UploadRequest {
  /** The request's Content-Type — must be one of the accepted kinds. */
  contentType: string | null;
  /** Declared size, used to refuse obviously-too-big uploads before reading. */
  contentLength: number | null;
  /** Original name, kept only as metadata (never used as a path). */
  fileName: string | null;
  body: ReadableStream<Uint8Array> | null;
}

function pickKind(kinds: Record<string, UploadKind>, contentType: string | null): UploadKind {
  const kind = kinds[(contentType ?? "").split(";")[0].trim().toLowerCase()];
  if (!kind) {
    throw new UploadError(
      `Tipo de arquivo não aceito. Use: ${Object.keys(kinds).join(", ")}.`,
      415,
    );
  }
  return kind;
}

function sanitizeFileName(name: string | null): string | null {
  const cleaned = (name ?? "").replace(/[\p{Cc}/\\]/gu, "").trim().slice(0, 200);
  return cleaned || null;
}

/** Stores the body on disk, then points the slot at it; the file is removed again if that fails. */
async function storeInto(
  slot: MediaSlot,
  request: UploadRequest,
  category: UploadCategory,
  kinds: Record<string, UploadKind>,
  maxBytes: number,
): Promise<void> {
  const kind = pickKind(kinds, request.contentType);
  if (request.contentLength !== null && request.contentLength > maxBytes) {
    throw new UploadError(
      `Arquivo maior que o limite de ${Math.floor(maxBytes / 1024 ** 2)} MB.`,
      413,
    );
  }

  const stored = await saveUpload(request.body, category, kind, maxBytes);
  try {
    const found = await replaceSlotWithStoredMedia(slot, {
      storageKey: stored.storageKey,
      url: publicUrlForKey(stored.storageKey),
      mimeType: stored.mimeType,
      sizeInBytes: stored.sizeInBytes,
      fileName: sanitizeFileName(request.fileName),
    });
    if (!found) {
      throw new UploadError("Conteúdo não encontrado.", 404);
    }
  } catch (error) {
    await removeStoredFiles([stored.storageKey]);
    throw error;
  }
}

export type ImageSlotName = "poster" | "backdrop";

export function uploadContentImage(
  model: "movie" | "series",
  id: string,
  slotName: ImageSlotName,
  request: UploadRequest,
): Promise<void> {
  const field = slotName === "poster" ? "posterMediaId" : "backdropMediaId";
  return storeInto({ model, id, field }, request, "images", IMAGE_KINDS, UPLOAD_LIMITS.image);
}

export function uploadContentVideo(
  model: "movie" | "episode",
  id: string,
  request: UploadRequest,
): Promise<void> {
  return storeInto(
    { model, id, field: "videoMediaId" },
    request,
    "videos",
    VIDEO_KINDS,
    UPLOAD_LIMITS.video,
  );
}

async function requireOwnedProfileId(userId: string, profileId: string): Promise<void> {
  const profile = await findProfileById(profileId);
  if (!profile || profile.userId !== userId) {
    throw new UploadError("Perfil não encontrado.", 404);
  }
}

export async function uploadProfileAvatar(
  userId: string,
  profileId: string,
  request: UploadRequest,
): Promise<void> {
  await requireOwnedProfileId(userId, profileId);
  await storeInto(
    { model: "profile", id: profileId, field: "avatarMediaId" },
    request,
    "avatars",
    IMAGE_KINDS,
    UPLOAD_LIMITS.avatar,
  );
}

export async function removeProfileAvatar(userId: string, profileId: string): Promise<void> {
  await requireOwnedProfileId(userId, profileId);
  await clearSlot({ model: "profile", id: profileId, field: "avatarMediaId" });
}
