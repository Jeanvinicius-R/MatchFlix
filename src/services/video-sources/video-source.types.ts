import type { StorageProvider } from "@/generated/prisma/enums";

/** A title found on a video source (an item/collection, not yet a playable file). */
export interface VideoSourceItem {
  itemId: string;
  title: string;
  year: number | null;
  /** Rough popularity signal used only to sort results. */
  downloads: number | null;
}

/** One playable file inside an item (a movie may have several qualities). */
export interface VideoSourceFile {
  fileName: string;
  /** Direct, browser-playable URL. Always built server-side. */
  url: string;
  mimeType: string;
  sizeInBytes: number | null;
  durationInSeconds: number | null;
  /** Human label, e.g. "MP4 · 424 MB". */
  label: string;
}

/**
 * Contract every video source (Internet Archive, and later others) implements.
 * The rest of the app only talks to this interface, so adding a source means
 * adding one file plus one line in `index.ts`.
 */
export interface VideoSourceProvider {
  /** Stable id used in URLs and forms. Also the key in the registry. */
  id: string;
  label: string;
  /** Value stored in `Media.storageProvider` for files from this source. */
  storageProvider: StorageProvider;
  search(query: string): Promise<VideoSourceItem[]>;
  listFiles(itemId: string): Promise<VideoSourceFile[]>;
}
