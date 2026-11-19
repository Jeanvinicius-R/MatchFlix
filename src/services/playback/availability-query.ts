import type { TitleQuery } from "./title-availability";

/** Query-string rules of GET /api/playback/availability (kept apart so they are testable). */

export type ParsedAvailabilityQuery =
  | { ok: true; query: TitleQuery; live: boolean }
  | { ok: false; error: string };

function parseInteger(raw: string | null, min: number, maxDigits: number): number | null {
  if (raw === null || !new RegExp(`^\\d{1,${maxDigits}}$`).test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

export function parseAvailabilityQuery(params: URLSearchParams): ParsedAvailabilityQuery {
  const tmdbId = parseInteger(params.get("tmdbId"), 1, 9);
  if (tmdbId === null) {
    return { ok: false, error: "Parâmetro 'tmdbId' inválido." };
  }

  const type = params.get("type");
  const live = params.get("check") === "1";

  if (type === "movie") {
    return {
      ok: true,
      query: { tmdbId, mediaType: "MOVIE", seasonNumber: 0, episodeNumber: 0 },
      live,
    };
  }

  if (type === "episode") {
    // Season 0 is TMDB's "Specials"; episodes start at 1.
    const seasonNumber = parseInteger(params.get("season"), 0, 4);
    const episodeNumber = parseInteger(params.get("episode"), 1, 5);
    if (seasonNumber === null || episodeNumber === null) {
      return { ok: false, error: "Informe 'season' e 'episode' válidos para o episódio." };
    }
    return {
      ok: true,
      query: { tmdbId, mediaType: "EPISODE", seasonNumber, episodeNumber },
      live,
    };
  }

  return { ok: false, error: "Parâmetro 'type' deve ser 'movie' ou 'episode'." };
}
