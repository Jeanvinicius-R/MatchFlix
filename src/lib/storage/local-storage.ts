import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";

/**
 * LOCAL storage for uploaded files (posters, backdrops, avatars, videos).
 * Files live on disk under MEDIA_UPLOAD_DIR (default "./uploads"); the
 * database only keeps `Media.storageKey` ("<category>/<uuid>.<ext>"). Names
 * are always generated here — nothing the client sends ever becomes a path.
 */

export type UploadCategory = "images" | "avatars" | "videos";

export interface UploadKind {
  mimeType: string;
  extension: string;
}

export const IMAGE_KINDS: Record<string, UploadKind> = {
  "image/jpeg": { mimeType: "image/jpeg", extension: "jpg" },
  "image/png": { mimeType: "image/png", extension: "png" },
  "image/webp": { mimeType: "image/webp", extension: "webp" },
};

export const VIDEO_KINDS: Record<string, UploadKind> = {
  "video/mp4": { mimeType: "video/mp4", extension: "mp4" },
  "video/webm": { mimeType: "video/webm", extension: "webm" },
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** The only shape a storage key may have — anything else is rejected before touching the disk. */
const STORAGE_KEY_PATTERN =
  /^(images|avatars|videos)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4|webm)$/;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export function getUploadRoot(): string {
  return path.resolve(process.env.MEDIA_UPLOAD_DIR?.trim() || path.join(process.cwd(), "uploads"));
}

export function isValidStorageKey(key: string): boolean {
  return STORAGE_KEY_PATTERN.test(key);
}

export function mimeTypeForKey(key: string): string | null {
  return MIME_BY_EXTENSION[path.extname(key).slice(1)] ?? null;
}

/** Absolute path for a key, or null when the key is not one this module generated. */
export function resolveStorageKey(key: string): string | null {
  if (!isValidStorageKey(key)) {
    return null;
  }
  const root = getUploadRoot();
  const absolute = path.resolve(root, ...key.split("/"));
  const relative = path.relative(root, absolute);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : absolute;
}

export function publicUrlForKey(key: string): string {
  return `/api/media/${key}`;
}

/**
 * Checks the file's first bytes against the declared type, so a renamed
 * executable or HTML page can never be stored as an "image/png".
 */
export function matchesSignature(mimeType: string, head: Uint8Array): boolean {
  const startsWith = (bytes: number[], offset = 0) =>
    bytes.every((byte, index) => head[offset + index] === byte);
  const ascii = (text: string, offset: number) =>
    startsWith(
      Array.from(text, (char) => char.charCodeAt(0)),
      offset,
    );

  switch (mimeType) {
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return ascii("RIFF", 0) && ascii("WEBP", 8);
    case "video/mp4":
      return ascii("ftyp", 4);
    case "video/webm":
      return startsWith([0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}

/** Bytes needed by matchesSignature. */
const SIGNATURE_BYTES = 12;

export interface StoredFile {
  storageKey: string;
  sizeInBytes: number;
  mimeType: string;
}

/**
 * Streams a request body to disk under a fresh name. Enforces the size limit
 * while streaming (never buffers a whole video in memory), checks the file
 * signature, and removes the partial file on any failure.
 */
export async function saveUpload(
  body: ReadableStream<Uint8Array> | null,
  category: UploadCategory,
  kind: UploadKind,
  maxBytes: number,
): Promise<StoredFile> {
  if (!body) {
    throw new UploadError("Nenhum arquivo enviado.");
  }

  const storageKey = `${category}/${randomUUID()}.${kind.extension}`;
  const absolute = resolveStorageKey(storageKey);
  if (!absolute) {
    throw new UploadError("Nome de arquivo inválido.", 500);
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true });

  const temporary = `${absolute}.part`;
  const output = createWriteStream(temporary, { flags: "wx" });
  const head = new Uint8Array(SIGNATURE_BYTES);
  let headLength = 0;
  let size = 0;

  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UploadError(
          `Arquivo maior que o limite de ${Math.floor(maxBytes / 1024 ** 2)} MB.`,
          413,
        );
      }
      if (headLength < SIGNATURE_BYTES) {
        const take = value.subarray(0, SIGNATURE_BYTES - headLength);
        head.set(take, headLength);
        headLength += take.byteLength;
      }
      if (!output.write(value)) {
        await new Promise<void>((resolve) => output.once("drain", resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });

    if (size === 0) {
      throw new UploadError("Arquivo vazio.");
    }
    if (!matchesSignature(kind.mimeType, head.subarray(0, headLength))) {
      throw new UploadError("O conteúdo do arquivo não corresponde ao tipo informado.", 415);
    }

    await fs.rename(temporary, absolute);
    return { storageKey, sizeInBytes: size, mimeType: kind.mimeType };
  } catch (error) {
    // Wait for the handle to really close (it may still be opening): removing
    // the file before that would let the pending open re-create it.
    if (!output.closed) {
      await new Promise<void>((resolve) => {
        output.once("close", () => resolve());
        output.destroy();
      });
    }
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

/** Removes stored files; a file that is already gone is not an error. */
export async function removeStoredFiles(keys: (string | null | undefined)[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      const absolute = key ? resolveStorageKey(key) : null;
      if (!absolute) {
        return;
      }
      try {
        await fs.rm(absolute, { force: true });
      } catch (error) {
        console.warn(`Não foi possível remover o arquivo ${key}:`, error);
      }
    }),
  );
}

export async function statStoredFile(
  key: string,
): Promise<{ absolutePath: string; sizeInBytes: number } | null> {
  const absolutePath = resolveStorageKey(key);
  if (!absolutePath) {
    return null;
  }
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile() ? { absolutePath, sizeInBytes: stats.size } : null;
  } catch {
    return null;
  }
}

/** Upload limits in bytes. The video limit is configurable (MEDIA_UPLOAD_MAX_VIDEO_MB). */
export const UPLOAD_LIMITS = {
  image: 5 * 1024 ** 2,
  avatar: 2 * 1024 ** 2,
  get video(): number {
    const megabytes = Number(process.env.MEDIA_UPLOAD_MAX_VIDEO_MB);
    return (Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 2048) * 1024 ** 2;
  },
};
