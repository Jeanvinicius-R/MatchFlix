import type {
  VideoSourceFile,
  VideoSourceItem,
  VideoSourceProvider,
} from "@/services/video-sources/video-source.types";

const ARCHIVE_BASE_URL = "https://archive.org";
const SEARCH_ROWS = 20;
const REQUEST_TIMEOUT_MS = 10_000;

/** Search and metadata rarely change; an hour of caching keeps the admin picker snappy. */
const CACHE_REVALIDATE_SECONDS = 60 * 60;

/** Archive identifiers are ASCII slugs. Anything else never reaches a URL path. */
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Only containers a browser's <video> can play natively. MKV/AVI/MPEG-2/ISO are skipped. */
const PLAYABLE_EXTENSIONS: Record<string, { mimeType: string; rank: number }> = {
  mp4: { mimeType: "video/mp4", rank: 0 },
  m4v: { mimeType: "video/mp4", rank: 0 },
  webm: { mimeType: "video/webm", rank: 1 },
  ogv: { mimeType: "video/ogg", rank: 2 },
};

interface ArchiveSearchDoc {
  identifier?: string;
  title?: string | string[];
  year?: number | string;
  downloads?: number;
}

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
  length?: string;
}

async function archiveGet<TResponse>(url: URL): Promise<TResponse> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    next: { revalidate: CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar o Internet Archive (HTTP ${response.status}).`);
  }

  return response.json() as Promise<TResponse>;
}

/** Keeps letters, digits and spaces so user input can't inject Lucene operators. */
function toSearchTerms(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(value: number | string | undefined): number | null {
  const year = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(year) ? year : null;
}

/** Archive reports length either as seconds ("4280.88") or as "HH:MM:SS". */
function parseDurationInSeconds(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  if (value.includes(":")) {
    const seconds = value
      .split(":")
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0);
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  }
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

function formatSize(sizeInBytes: number | null): string {
  if (sizeInBytes === null) {
    return "tamanho desconhecido";
  }
  const megabytes = sizeInBytes / 1024 ** 2;
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${Math.round(megabytes)} MB`;
}

function getExtension(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
}

function buildDownloadUrl(itemId: string, fileName: string): string {
  const encodedPath = fileName.split("/").map(encodeURIComponent).join("/");
  return `${ARCHIVE_BASE_URL}/download/${encodeURIComponent(itemId)}/${encodedPath}`;
}

async function search(query: string): Promise<VideoSourceItem[]> {
  const terms = toSearchTerms(query);
  if (!terms) {
    return [];
  }

  const url = new URL(`${ARCHIVE_BASE_URL}/advancedsearch.php`);
  url.searchParams.set("q", `title:(${terms}) AND mediatype:movies`);
  for (const field of ["identifier", "title", "year", "downloads"]) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.set("sort[]", "downloads desc");
  url.searchParams.set("rows", String(SEARCH_ROWS));
  url.searchParams.set("output", "json");

  const data = await archiveGet<{ response?: { docs?: ArchiveSearchDoc[] } }>(url);

  return (data.response?.docs ?? []).flatMap((doc) => {
    if (!doc.identifier || !ITEM_ID_PATTERN.test(doc.identifier)) {
      return [];
    }
    const title = Array.isArray(doc.title) ? doc.title[0] : doc.title;
    return [
      {
        itemId: doc.identifier,
        title: title ?? doc.identifier,
        year: parseYear(doc.year),
        downloads: doc.downloads ?? null,
      },
    ];
  });
}

async function listFiles(itemId: string): Promise<VideoSourceFile[]> {
  if (!ITEM_ID_PATTERN.test(itemId)) {
    throw new Error("Identificador do Internet Archive inválido.");
  }

  const url = new URL(`${ARCHIVE_BASE_URL}/metadata/${encodeURIComponent(itemId)}`);
  const data = await archiveGet<{ files?: ArchiveFile[] }>(url);

  return (data.files ?? [])
    .flatMap((file) => {
      const playable = PLAYABLE_EXTENSIONS[getExtension(file.name)];
      if (!playable) {
        return [];
      }
      const sizeInBytes = file.size ? Number.parseInt(file.size, 10) : null;
      return [
        {
          rank: playable.rank,
          file: {
            fileName: file.name,
            url: buildDownloadUrl(itemId, file.name),
            mimeType: playable.mimeType,
            sizeInBytes: Number.isFinite(sizeInBytes) ? sizeInBytes : null,
            durationInSeconds: parseDurationInSeconds(file.length),
            label: `${getExtension(file.name).toUpperCase()} · ${formatSize(
              Number.isFinite(sizeInBytes) ? sizeInBytes : null,
            )} · ${file.name}`,
          } satisfies VideoSourceFile,
        },
      ];
    })
    .sort(
      (a, b) => a.rank - b.rank || (b.file.sizeInBytes ?? 0) - (a.file.sizeInBytes ?? 0),
    )
    .map(({ file }) => file);
}

export const internetArchiveProvider: VideoSourceProvider = {
  id: "internet-archive",
  label: "Internet Archive",
  storageProvider: "INTERNET_ARCHIVE",
  search,
  listFiles,
};
