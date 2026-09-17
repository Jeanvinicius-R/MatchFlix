const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

/** Metadata barely ever changes minute-to-minute — cache responses for a day. */
const CACHE_REVALIDATE_SECONDS = 60 * 60 * 24;

function getAccessToken(): string {
  const token = process.env.TMDB_ACCESS_TOKEN;
  if (!token) {
    throw new Error("TMDB_ACCESS_TOKEN não está definida. Configure o arquivo .env.");
  }
  return token;
}

interface TmdbRequestOptions {
  searchParams?: Record<string, string | number | undefined>;
}

/** Low-level GET against the TMDB API. Never called outside this module. */
export async function tmdbGet<TResponse>(
  path: string,
  options: TmdbRequestOptions = {},
): Promise<TResponse> {
  const url = new URL(`${TMDB_API_BASE_URL}${path}`);
  url.searchParams.set("language", "pt-BR");

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      Accept: "application/json",
    },
    next: { revalidate: CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar a TMDB (HTTP ${response.status}) em ${path}`);
  }

  return response.json() as Promise<TResponse>;
}

export type TmdbImageSize = "w500" | "w1280" | "original";

export function buildTmdbImageUrl(
  path: string | null,
  size: TmdbImageSize,
): string | null {
  if (!path) {
    return null;
  }
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}
