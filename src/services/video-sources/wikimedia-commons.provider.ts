import type {
  VideoSourceFile,
  VideoSourceItem,
  VideoSourceProvider,
} from "@/services/video-sources/video-source.types";

const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
const SEARCH_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_REVALIDATE_SECONDS = 60 * 60;

/** File titles go into an API query, where "|" separates values. No control chars either. */
const FILE_TITLE_PATTERN = /^[^|\p{Cc}#<>[\]{}]{1,200}$/u;

const PLAYABLE_MIME_TYPES = new Set(["video/webm", "video/ogg", "video/mp4"]);

interface CommonsSearchResponse {
  query?: { search?: { title: string }[] };
}

interface CommonsImageInfo {
  url: string;
  size?: number;
  duration?: number;
  mime?: string;
  mediatype?: string;
}

interface CommonsInfoResponse {
  query?: { pages?: Record<string, { imageinfo?: CommonsImageInfo[] }> };
}

async function commonsGet<TResponse>(params: Record<string, string>): Promise<TResponse> {
  const url = new URL(COMMONS_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    next: { revalidate: CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar a Wikimedia Commons (HTTP ${response.status}).`);
  }

  return response.json() as Promise<TResponse>;
}

function stripFilePrefix(title: string): string {
  return title.replace(/^File:/, "");
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
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

async function search(query: string): Promise<VideoSourceItem[]> {
  const terms = query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!terms) {
    return [];
  }

  const data = await commonsGet<CommonsSearchResponse>({
    list: "search",
    srsearch: `${terms} filetype:video`,
    srnamespace: "6",
    srlimit: String(SEARCH_LIMIT),
  });

  return (data.query?.search ?? []).map((result) => {
    const fileName = stripFilePrefix(result.title);
    const year = /\b(1[89]\d{2}|20\d{2})\b/.exec(fileName)?.[1];
    return {
      itemId: fileName,
      title: stripExtension(fileName),
      year: year ? Number(year) : null,
      downloads: null,
    };
  });
}

/** On Commons an "item" is a single video file, so this returns zero or one file. */
async function listFiles(itemId: string): Promise<VideoSourceFile[]> {
  if (!FILE_TITLE_PATTERN.test(itemId)) {
    throw new Error("Nome de arquivo da Wikimedia Commons inválido.");
  }

  const data = await commonsGet<CommonsInfoResponse>({
    prop: "imageinfo",
    iiprop: "url|size|mime|mediatype",
    titles: `File:${itemId}`,
  });

  const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info || info.mediatype !== "VIDEO" || !info.mime) {
    return [];
  }
  if (!PLAYABLE_MIME_TYPES.has(info.mime)) {
    return [];
  }

  // The API tags the URL with utm_* tracking params; the bare URL is what we store.
  const url = new URL(info.url);
  url.search = "";

  const sizeInBytes = info.size ?? null;
  return [
    {
      fileName: itemId,
      url: url.toString(),
      mimeType: info.mime,
      sizeInBytes,
      durationInSeconds: info.duration ? Math.round(info.duration) : null,
      label: `${itemId.slice(itemId.lastIndexOf(".") + 1).toUpperCase()} · ${formatSize(
        sizeInBytes,
      )} · ${itemId}`,
    },
  ];
}

export const wikimediaCommonsProvider: VideoSourceProvider = {
  id: "wikimedia-commons",
  label: "Wikimedia Commons",
  storageProvider: "WIKIMEDIA_COMMONS",
  search,
  listFiles,
};
