/**
 * Parameter rules and pagination for the /api/catalog routes. Pure (no Next.js,
 * no Prisma) so they are unit-tested; the routes only wire them to services.
 */

export const CATALOG_PAGE_SIZE = 24;
/** Nobody pages this far; it only bounds the SQL offset. */
const MAX_PAGE = 100_000;

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

export interface PageView<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Digits only, no sign/decimal/exponent: "1e3" or "-1" are not ids. */
function parseDigits(raw: string, maxDigits: number, min: number): number | null {
  const text = raw.trim();
  if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

/** Missing => page 1; anything that is not a positive whole number => null (400). */
export function parsePage(raw: string | null): number | null {
  if (raw === null) {
    return 1;
  }
  const page = parseDigits(raw, 6, 1);
  return page !== null && page <= MAX_PAGE ? page : null;
}

/** A TMDB id (positive integer). */
export function parseTmdbId(raw: string): number | null {
  return parseDigits(raw, 9, 1);
}

/** A season number; 0 is TMDB's "Specials". */
export function parseSeasonNumber(raw: string): number | null {
  return parseDigits(raw, 4, 0);
}

/** Trimmed search text, or null when missing / too short / too long. */
export function parseSearchTerm(raw: string | null): string | null {
  const term = raw?.trim().replace(/\s+/g, " ") ?? "";
  if (term.length < SEARCH_MIN_LENGTH || term.length > SEARCH_MAX_LENGTH) {
    return null;
  }
  return term;
}

export function buildPageView<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): PageView<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * tmdbGet throws a plain Error whose message carries the HTTP status
 * ("Falha ao consultar a TMDB (HTTP 404) em /movie/1"); this recognizes the
 * 404 so the routes can answer "not found" instead of a generic failure.
 */
export function isTmdbNotFound(error: unknown): boolean {
  return error instanceof Error && /\(HTTP 404\)/.test(error.message);
}
