import { internetArchiveProvider } from "@/services/video-sources/internet-archive.provider";
import type {
  VideoSourceFile,
  VideoSourceProvider,
} from "@/services/video-sources/video-source.types";
import { wikimediaCommonsProvider } from "@/services/video-sources/wikimedia-commons.provider";

/** Register new sources here — nothing else in the app needs to change. */
const PROVIDERS: VideoSourceProvider[] = [
  internetArchiveProvider,
  wikimediaCommonsProvider,
];

export function listVideoSourceProviders(): VideoSourceProvider[] {
  return PROVIDERS;
}

export function getVideoSourceProvider(id: string): VideoSourceProvider | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

const FORMAT_RANK: Record<string, number> = {
  "video/mp4": 0,
  "video/webm": 1,
  "video/ogg": 2,
};

/** "Ep01.mp4" and "Ep01_512kb.mp4" are the same video; compare on the normalized stem. */
function toVideoStem(fileName: string): string {
  return fileName
    .replace(/\.[^./]+$/, "")
    .replace(/[_. -]?512kb$/i, "")
    .toLowerCase();
}

/**
 * Turns an item's raw file list into one entry per distinct video, in natural
 * name order ("ep2" before "ep10"). This is the order episodes are matched to.
 */
export function orderFilesForEpisodes(files: VideoSourceFile[]): VideoSourceFile[] {
  const bestByStem = new Map<string, VideoSourceFile>();

  for (const file of files) {
    const stem = toVideoStem(file.fileName);
    const current = bestByStem.get(stem);
    const rank = FORMAT_RANK[file.mimeType] ?? 9;
    const currentRank = current ? (FORMAT_RANK[current.mimeType] ?? 9) : Infinity;

    if (
      !current ||
      rank < currentRank ||
      (rank === currentRank && (file.sizeInBytes ?? 0) > (current.sizeInBytes ?? 0))
    ) {
      bestByStem.set(stem, file);
    }
  }

  return [...bestByStem.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, file]) => file);
}
