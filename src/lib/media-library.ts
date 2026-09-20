import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The user's own video folder ("Meus arquivos"). Everything the site reads from
 * disk goes through this module so paths can never escape the folder.
 */

const DEFAULT_LIBRARY_DIR = path.join(process.cwd(), "movies");
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_FILES = 5000;
const SCAN_CACHE_MS = 10_000;

/** Containers a browser can play directly. MKV works in Chrome/Edge only; nothing is transcoded. */
export const LIBRARY_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
};

export interface LibraryFile {
  /** Path relative to the library folder, always with "/" separators. */
  relativePath: string;
  sizeInBytes: number;
  extension: string;
}

export function getLibraryRoot(): string {
  return path.resolve(process.env.MEDIA_LIBRARY_DIR?.trim() || DEFAULT_LIBRARY_DIR);
}

export function getMimeType(fileName: string): string | null {
  return LIBRARY_MIME_TYPES[path.extname(fileName).slice(1).toLowerCase()] ?? null;
}

/**
 * Turns a relative path into an absolute one, or null when it is unsafe
 * (absolute, contains "..", other drives, control characters...).
 */
export function resolveLibraryPath(relativePath: string): string | null {
  if (!relativePath || /[\0-\x1f]/.test(relativePath) || path.isAbsolute(relativePath)) {
    return null;
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    return null;
  }

  const root = getLibraryRoot();
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

/** Like resolveLibraryPath, but also follows symlinks so a link can't point outside the folder. */
export async function resolveExistingLibraryFile(
  relativePath: string,
): Promise<{ absolutePath: string; sizeInBytes: number } | null> {
  const resolved = resolveLibraryPath(relativePath);
  if (!resolved || !getMimeType(resolved)) {
    return null;
  }
  try {
    const [realFile, realRoot] = await Promise.all([
      fs.realpath(resolved),
      fs.realpath(getLibraryRoot()),
    ]);
    const relative = path.relative(realRoot, realFile);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    const stats = await fs.stat(realFile);
    return stats.isFile() ? { absolutePath: realFile, sizeInBytes: stats.size } : null;
  } catch {
    return null;
  }
}

let scanCache: { at: number; files: LibraryFile[] } | null = null;

async function walk(directory: string, depth: number, out: LibraryFile[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_SCAN_FILES) {
    return;
  }
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, depth + 1, out);
    } else if (entry.isFile() && getMimeType(entry.name)) {
      const stats = await fs.stat(absolute).catch(() => null);
      if (stats) {
        out.push({
          relativePath: path
            .relative(getLibraryRoot(), absolute)
            .split(path.sep)
            .join("/"),
          sizeInBytes: stats.size,
          extension: path.extname(entry.name).slice(1).toLowerCase(),
        });
      }
    }
  }
}

/** Every playable video in the folder. Missing folder = empty list, not an error. */
export async function listLibraryFiles(): Promise<LibraryFile[]> {
  if (scanCache && Date.now() - scanCache.at < SCAN_CACHE_MS) {
    return scanCache.files;
  }
  const files: LibraryFile[] = [];
  await walk(getLibraryRoot(), 0, files);
  files.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
  scanCache = { at: Date.now(), files };
  return files;
}

export function clearLibraryCache(): void {
  scanCache = null;
}
