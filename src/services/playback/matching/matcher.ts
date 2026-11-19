import type { MatchMethodValue } from "../../../schemas/playback-candidate.schemas";
import type {
  DiscoveryQuery,
  ProviderCandidate,
  ProviderCatalogItem,
} from "../adapters/adapter.types";

/**
 * Scores how likely a provider item is the requested TMDB title. The result is a
 * SUGGESTION for an administrator, never proof of rights:
 *
 *   - an identifier the provider itself declares is the strong evidence
 *     (tmdb_id = 100, imdb_id = 98) and the only thing that may be approved in batch;
 *   - title + year (+ runtime) is weak evidence, capped at 89 so it can never reach
 *     the score of an identifier match;
 *   - an identifier that points to ANOTHER title discards the candidate;
 *   - below MIN_STORED_SCORE nothing is stored.
 */

export const TMDB_ID_SCORE = 100;
export const IMDB_ID_SCORE = 98;

/** Same title and same year, no identifier. */
export const EXACT_TITLE_SCORE = 80;
/** Same title, year off by one: too weak to store. */
export const NEAR_YEAR_SCORE = 65;
/** Near-identical title (Dice >= SIMILAR_TITLE_THRESHOLD) and same year. */
export const SIMILAR_TITLE_SCORE = 72;
/** Bonus when the provider's duration is within RUNTIME_TOLERANCE of TMDB's. */
export const RUNTIME_BONUS = 8;

export const SIMILAR_TITLE_THRESHOLD = 0.92;
export const RUNTIME_TOLERANCE = 0.1;
/** Durations further apart than this are different cuts (trailer, extra): discarded. */
export const RUNTIME_MAX_DIFFERENCE = 0.5;

/** Metadata-only matches never reach identifier territory. */
export const MAX_METADATA_SCORE = 89;
/** Lowest score worth showing to an administrator. */
export const MIN_STORED_SCORE = 70;

export interface MatchResult {
  method: MatchMethodValue;
  score: number;
  /** Why the system thinks it is the same title (pt-BR, shown to the admin). */
  reason: string;
}

/**
 * A discovered candidate, or a catalog item (which also says movie/episode and
 * carries the series title and the season/episode numbers).
 */
export type MatchableCandidate = ProviderCandidate &
  Partial<
    Pick<ProviderCatalogItem, "mediaType" | "seriesTitle" | "seasonNumber" | "episodeNumber">
  >;

const LEADING_ARTICLE = /^(?:the|a|an|o|os|um|uma)\s+(?=\S)/;

/** "(2019)" or "[HD]"-style tags a provider appends to a title. */
const TRAILING_GROUP = /\s*[([]([^()[\]]*)[)\]]\s*$/;
const NOISE_TAG =
  /^(?:(?:19|20)\d{2}|hd|fhd|uhd|sd|4k|8k|\d{3,4}p|dub(?:lado)?|leg(?:endado)?|dual(?: audio)?|multi|blu-?ray|web-?dl|webrip|hdtv|hdr|cam|remux)$/;

/** Everything that is not a letter or digit (built at runtime: needs \p, newer than the TS target). */
const NON_ALPHANUMERIC = new RegExp("[^\\p{L}\\p{N}]+", "gu");

export function stripTrailingNoise(text: string): string {
  let value = text.trim();

  for (;;) {
    const match = TRAILING_GROUP.exec(value);

    if (!match || !NOISE_TAG.test(match[1].trim())) {
      return value;
    }

    const rest = value.slice(0, match.index).trim();

    // A title that is only a tag ("(2019)") keeps it.
    if (rest === "") {
      return value;
    }

    value = rest;
  }
}

/**
 * Lowercase, no accents, no punctuation, no leading article (the/a/an/o/os/um/uma)
 * and no trailing "(2019)" / "[HD]" tag, so "A Fuga das Galinhas (2000) [HD]" and
 * "fuga das galinhas" compare equal.
 */
export function normalizeTitle(raw: string): string {
  const lowered = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase();
  const words = stripTrailingNoise(lowered)
    .replace(NON_ALPHANUMERIC, " ")
    .trim()
    .replace(LEADING_ARTICLE, "");

  return words.trim();
}

function bigramsOf(text: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (let index = 0; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  return counts;
}

/** Dice coefficient over character bigrams of two ALREADY normalized strings. */
function diceOfNormalized(a: string, b: string): number {
  if (a === "" || b === "") {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const left = bigramsOf(a);
  const right = bigramsOf(b);
  let shared = 0;

  for (const [pair, count] of left) {
    shared += Math.min(count, right.get(pair) ?? 0);
  }

  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/** 0..1 similarity (Dice over bigrams) between two titles, after normalization. */
export function similarity(a: string, b: string): number {
  return diceOfNormalized(normalizeTitle(a), normalizeTitle(b));
}

function readImdb(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^tt\d+$/.test(normalized) ? normalized : undefined;
}

function readTmdb(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function readPositive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function describeEpisode(query: DiscoveryQuery): string {
  return query.mediaType === "EPISODE"
    ? ` (temporada ${query.seasonNumber}, episódio ${query.episodeNumber})`
    : "";
}

/** Titles the query can be known by, normalized and without duplicates. */
function queryTitles(query: DiscoveryQuery): string[] {
  const titles = [query.title, query.originalTitle]
    .map((title) => (title ? normalizeTitle(title) : ""))
    .filter((title) => title !== "");

  return Array.from(new Set(titles));
}

function scoreByMetadata(
  query: DiscoveryQuery,
  candidate: MatchableCandidate,
): MatchResult | null {
  const rawTitle =
    query.mediaType === "EPISODE" ? (candidate.seriesTitle ?? candidate.title) : candidate.title;
  const candidateTitle = normalizeTitle(rawTitle);
  const titles = queryTitles(query);
  const queryYear = readPositive(query.year);
  const candidateYear = readPositive(candidate.year);

  // Without a title or a year there is nothing to compare: fail closed.
  if (candidateTitle === "" || titles.length === 0) {
    return null;
  }

  if (queryYear === undefined || candidateYear === undefined) {
    return null;
  }

  const yearDifference = Math.abs(queryYear - candidateYear);
  const exact = titles.includes(candidateTitle);
  const closeness = Math.max(...titles.map((title) => diceOfNormalized(title, candidateTitle)));
  let base: number | null = null;
  let titleReason: string;

  if (exact) {
    base =
      yearDifference === 0 ? EXACT_TITLE_SCORE : yearDifference === 1 ? NEAR_YEAR_SCORE : null;
    titleReason = `Título igual ("${candidate.title}")`;
  } else if (closeness >= SIMILAR_TITLE_THRESHOLD && yearDifference === 0) {
    base = SIMILAR_TITLE_SCORE;
    titleReason = `Título muito parecido ("${candidate.title}", ${Math.round(
      closeness * 100,
    )}% de similaridade com "${query.title}")`;
  } else {
    return null;
  }

  if (base === null || base < MIN_STORED_SCORE) {
    return null;
  }

  let score = base;
  let runtimeReason = "";
  const queryRuntime = readPositive(query.runtimeMinutes);
  const candidateRuntime = readPositive(candidate.durationMinutes);

  if (queryRuntime !== undefined && candidateRuntime !== undefined) {
    const difference = Math.abs(candidateRuntime - queryRuntime) / queryRuntime;

    if (difference > RUNTIME_MAX_DIFFERENCE) {
      return null;
    }

    if (difference <= RUNTIME_TOLERANCE) {
      score += RUNTIME_BONUS;
      runtimeReason = ` Duração compatível (${Math.round(candidateRuntime)} min contra ${Math.round(
        queryRuntime,
      )} min na TMDB).`;
    }
  }

  return {
    method: "METADATA",
    score: Math.min(score, MAX_METADATA_SCORE),
    reason: `${titleReason} e mesmo ano (${queryYear}).${runtimeReason} O provedor não declara identificador: confira antes de aprovar.`,
  };
}

/**
 * The best evidence that `candidate` is the title `query` asks for, or null when
 * there is none (or when it points to another title). An episode query needs the
 * candidate to carry the very same season and episode.
 */
export function scoreCandidate(
  query: DiscoveryQuery,
  candidate: MatchableCandidate,
): MatchResult | null {
  if (candidate.mediaType !== undefined && candidate.mediaType !== query.mediaType) {
    return null;
  }

  if (
    query.mediaType === "EPISODE" &&
    (candidate.seasonNumber !== query.seasonNumber ||
      candidate.episodeNumber !== query.episodeNumber)
  ) {
    return null;
  }

  const declaredTmdb = readTmdb(candidate.externalIds?.tmdb);
  const declaredImdb = readImdb(candidate.externalIds?.imdb);
  const queryImdb = readImdb(query.imdbId);

  // The provider says it is ANOTHER title: never suggest it.
  if (declaredTmdb !== undefined && declaredTmdb !== query.tmdbId) {
    return null;
  }

  if (declaredImdb !== undefined && queryImdb !== undefined && declaredImdb !== queryImdb) {
    return null;
  }

  if (declaredTmdb !== undefined) {
    return {
      method: "TMDB_ID",
      score: TMDB_ID_SCORE,
      reason: `O provedor declara tmdb_id ${declaredTmdb}${describeEpisode(query)}.`,
    };
  }

  if (declaredImdb !== undefined && declaredImdb === queryImdb) {
    return {
      method: "IMDB_ID",
      score: IMDB_ID_SCORE,
      reason: `O provedor declara imdb_id ${declaredImdb}${describeEpisode(query)}.`,
    };
  }

  return scoreByMetadata(query, candidate);
}
