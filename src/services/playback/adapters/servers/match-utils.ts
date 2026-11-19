/**
 * Title helpers shared by the server adapters' discover(): they only decide
 * which provider items are WORTH SUGGESTING. A match is never proof; the
 * candidate service scores it and an administrator approves it.
 */

/** Lowercase ASCII words separated by single spaces ("O Cavaleiro das Trevas" -> "o cavaleiro das trevas"). */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Splits a provider title such as "[PT-BR] Matrix (1999) [4K]" into the bare
 * title and the year. Leading tags and trailing (...)/[...] groups are dropped.
 */
export function splitTitleYear(raw: string): { title: string; year?: number } {
  const text = raw.trim().replace(/^(\[[^\]]{0,24}\]\s*)+/, "");
  const yearMatch = /[(\[]\s*((?:19|20)\d{2})\s*[)\]]/.exec(text);

  if (yearMatch && yearMatch.index > 0) {
    return {
      title: text.slice(0, yearMatch.index).trim(),
      year: Number(yearMatch[1]),
    };
  }

  return { title: text.replace(/(\s*[\[(][^\])]*[\])])+\s*$/, "").trim() };
}

/** Same non-empty normalized title as any of the wanted ones. */
export function titlesMatch(wanted: readonly (string | undefined)[], candidate: string): boolean {
  const normalized = normalizeTitle(candidate);

  if (normalized === "") {
    return false;
  }

  return wanted.some((title) => title !== undefined && normalizeTitle(title) === normalized);
}

/** Unknown years do not rule a candidate out; known ones may differ by 1 (release dates vary). */
export function yearsClose(a: number | undefined, b: number | undefined): boolean {
  return a === undefined || b === undefined || Math.abs(a - b) <= 1;
}

/** A positive integer TMDB id from a number or a digits-only string, else undefined. */
export function parseTmdbId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d{1,9}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

/** "tt0133093" from a string, else undefined. */
export function parseImdbId(value: unknown): string | undefined {
  return typeof value === "string" && /^tt\d{5,10}$/.test(value.trim())
    ? value.trim()
    : undefined;
}

/** A plausible release year (1888..2100) from a number, "1999" or "1999-03-31". */
export function parseYear(value: unknown): number | undefined {
  const text = typeof value === "number" ? String(value) : value;

  if (typeof text !== "string") {
    return undefined;
  }

  const match = /^\s*(\d{4})(?:\D|$)/.exec(text);
  const year = match ? Number(match[1]) : NaN;

  return year >= 1888 && year <= 2100 ? year : undefined;
}

/** "S01E02", "s1e2" or "1x02" at the end of a name, with the series title before it. */
export function parseEpisodeName(
  raw: string,
): { seriesTitle: string; season: number; episode: number } | null {
  const match =
    /^(.*?)[\s._-]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})(?!\d)/.exec(raw) ??
    /^(.*?)[\s._-]+(\d{1,2})x(\d{1,3})(?!\d)/.exec(raw);

  if (!match || match[1].trim() === "") {
    return null;
  }

  return {
    seriesTitle: splitTitleYear(match[1]).title,
    season: Number(match[2]),
    episode: Number(match[3]),
  };
}
