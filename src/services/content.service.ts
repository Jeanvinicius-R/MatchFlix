import {
  findAllContent,
  findAllMovies,
  findAllSeries,
  findContentByGenreSlug,
  findFeaturedContent,
  searchContent,
} from "@/repositories/content.repository";
import type { ContentRow, ContentSummary } from "@/types/content.types";

/**
 * Business logic for browsing content. Components must call this layer
 * instead of the repository directly, so future rules (personalization,
 * regional availability, active/inactive flags) live in one place.
 */

export async function getHeroHighlight(kidsOnly = false): Promise<ContentSummary> {
  const featured = await findFeaturedContent(kidsOnly);

  if (!featured) {
    throw new Error("Nenhum conteúdo ativo encontrado para destacar na Home.");
  }

  return featured;
}

export async function getHomeContentRows(kidsOnly = false): Promise<ContentRow[]> {
  const [series, action, drama] = await Promise.all([
    findContentByGenreSlug("ficcao-cientifica", kidsOnly),
    findContentByGenreSlug("acao", kidsOnly),
    findContentByGenreSlug("drama", kidsOnly),
  ]);

  const allContent = await findAllContent(kidsOnly);

  const rows: ContentRow[] = [
    { id: "row-populares", title: "Em alta na MatchFlix", items: allContent },
    { id: "row-ficcao", title: "Ficção científica", items: series },
    { id: "row-acao", title: "Ação e adrenalina", items: action },
    { id: "row-drama", title: "Dramas aclamados", items: drama },
  ];

  return rows.filter((row) => row.items.length > 0);
}

export function getMovieCatalog(kidsOnly = false): Promise<ContentSummary[]> {
  return findAllMovies(kidsOnly);
}

export function getSeriesCatalog(kidsOnly = false): Promise<ContentSummary[]> {
  return findAllSeries(kidsOnly);
}

/** Blank or one-character queries match almost everything, so they return nothing. */
export async function searchCatalog(
  rawQuery: string,
  kidsOnly = false,
): Promise<ContentSummary[]> {
  const query = rawQuery.trim();
  if (query.length < 2) {
    return [];
  }
  return searchContent(query, kidsOnly);
}
