import { getMovieDetails, getSeriesDetails } from "@/services/tmdb/tmdb.service";

export class ImageSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageSourceError";
  }
}

export interface FetchedImages {
  posterUrl: string | null;
  backdropUrl: string | null;
}

/**
 * The TMDB id comes from the client, but the image URLs never do: they are
 * read back from TMDB here, so only TMDB\x27s own CDN URLs can end up stored.
 */
async function toImages(
  load: () => Promise<{ posterUrl: string | null; backdropUrl: string | null }>,
): Promise<FetchedImages> {
  let details;
  try {
    details = await load();
  } catch {
    throw new ImageSourceError("Não foi possível consultar a TMDB. Tente novamente.");
  }

  if (!details.posterUrl && !details.backdropUrl) {
    throw new ImageSourceError("A TMDB não tem imagens para este título.");
  }
  return { posterUrl: details.posterUrl, backdropUrl: details.backdropUrl };
}

export function fetchMovieImages(tmdbId: number): Promise<FetchedImages> {
  return toImages(() => getMovieDetails(tmdbId));
}

export function fetchSeriesImages(tmdbId: number): Promise<FetchedImages> {
  return toImages(() => getSeriesDetails(tmdbId));
}
