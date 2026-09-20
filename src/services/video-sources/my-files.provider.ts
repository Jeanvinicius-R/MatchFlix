import {
  getMimeType,
  listLibraryFiles,
  resolveExistingLibraryFile,
} from "@/lib/media-library";
import type {
  VideoSourceFile,
  VideoSourceItem,
  VideoSourceProvider,
} from "@/services/video-sources/video-source.types";

const MAX_RESULTS = 60;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatSize(sizeInBytes: number): string {
  const megabytes = sizeInBytes / 1024 ** 2;
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${Math.round(megabytes)} MB`;
}

function toUrl(relativePath: string): string {
  return `/api/library/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * "Meus arquivos": the user's own videos in the library folder. Search ranks the
 * folder's files by how many words of the query appear in the name, and still lists
 * the rest — file names rarely match a Portuguese title exactly.
 */
async function search(query: string): Promise<VideoSourceItem[]> {
  const terms = normalize(query).split(" ").filter(Boolean);
  const files = await listLibraryFiles();

  return files
    .map((file) => {
      const name = normalize(file.relativePath);
      const score = terms.filter((term) => name.includes(term)).length;
      const year = /\b(19|20)\d{2}\b/.exec(name)?.[0];
      return { file, score, year: year ? Number(year) : null };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ file, year }) => ({
      itemId: file.relativePath,
      title: file.relativePath,
      year,
      downloads: null,
    }));
}

async function listFiles(itemId: string): Promise<VideoSourceFile[]> {
  const file = await resolveExistingLibraryFile(itemId);
  const mimeType = getMimeType(itemId);
  if (!file || !mimeType) {
    return [];
  }

  return [
    {
      fileName: itemId,
      url: toUrl(itemId),
      mimeType,
      sizeInBytes: file.sizeInBytes,
      durationInSeconds: null,
      label: `${itemId.split(".").pop()?.toUpperCase()} · ${formatSize(file.sizeInBytes)} · ${itemId}`,
    },
  ];
}

export const myFilesProvider: VideoSourceProvider = {
  id: "my-files",
  label: "Meus arquivos",
  storageProvider: "LOCAL",
  search,
  listFiles,
};
