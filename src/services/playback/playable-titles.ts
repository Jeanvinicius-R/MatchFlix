import {
  computeAvailabilityState,
  getFreshHours,
  isConfirmed,
  type AvailabilityRecord,
} from "./availability-state";

/**
 * Which catalog cards may say "has video" because of a VERIFIED association.
 * Only CONFIRMED titles count (VERIFIED + AVAILABLE + checked recently): an
 * association that merely exists in the database proves nothing about the
 * video being reachable. The set is cached in memory for a short time so a
 * Home page full of cards costs one query, never one per card.
 *
 * No Prisma here: the loader is injected (see playable-titles.default.ts).
 */

export const PLAYABLE_TITLES_TTL_MS = 30_000;

export interface PlayableTitleRecord extends AvailabilityRecord {
  /** For EPISODE rows this is the series' TMDB id. */
  tmdbId: number;
  mediaType: "MOVIE" | "EPISODE";
}

export interface PlayableLookup {
  hasMovie(tmdbId: number | null): boolean;
  hasSeries(tmdbId: number | null): boolean;
}

export interface PlayableTitlesDeps {
  loadRecords: () => Promise<readonly PlayableTitleRecord[]>;
  /** Epoch milliseconds. */
  now?: () => number;
  ttlMs?: number;
  /** Re-read on every refresh so the env var can change without a restart. */
  freshHours?: () => number;
}

function groupByTmdbId(records: readonly PlayableTitleRecord[]) {
  const groups = new Map<number, PlayableTitleRecord[]>();
  for (const record of records) {
    const group = groups.get(record.tmdbId);
    if (group) {
      group.push(record);
    } else {
      groups.set(record.tmdbId, [record]);
    }
  }
  return groups;
}

/** Builds the lookup for one snapshot of records. */
export function buildPlayableLookup(
  records: readonly PlayableTitleRecord[],
  now: number,
  freshHours: number,
): PlayableLookup {
  function confirmedIds(mediaType: PlayableTitleRecord["mediaType"]): Set<number> {
    const ids = new Set<number>();
    const groups = groupByTmdbId(records.filter((record) => record.mediaType === mediaType));
    for (const [tmdbId, group] of groups) {
      if (isConfirmed(computeAvailabilityState(group, now, freshHours))) {
        ids.add(tmdbId);
      }
    }
    return ids;
  }

  const movies = confirmedIds("MOVIE");
  // A series counts when any of its episodes is confirmed.
  const series = confirmedIds("EPISODE");

  return {
    hasMovie: (tmdbId) => tmdbId !== null && movies.has(tmdbId),
    hasSeries: (tmdbId) => tmdbId !== null && series.has(tmdbId),
  };
}

export function createPlayableTitles(deps: PlayableTitlesDeps) {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? PLAYABLE_TITLES_TTL_MS;
  const freshHours = deps.freshHours ?? getFreshHours;

  let cached: { lookup: PlayableLookup; expiresAt: number } | null = null;
  let inFlight: Promise<PlayableLookup | null> | null = null;

  async function refresh(): Promise<PlayableLookup | null> {
    try {
      const records = await deps.loadRecords();
      const at = now();
      const lookup = buildPlayableLookup(records, at, freshHours());
      cached = { lookup, expiresAt: at + ttlMs };
      return lookup;
    } catch (error) {
      // The caller falls back to the old behaviour; a failure is never cached.
      console.warn("Playback: disponibilidade dos cards indisponível.", error);
      return null;
    }
  }

  return {
    /** Null when the database failed: callers then keep their previous behaviour. */
    async get(): Promise<PlayableLookup | null> {
      if (cached && cached.expiresAt > now()) {
        return cached.lookup;
      }
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },

    /** Drops the cache (after an approval/revocation, and in tests). */
    invalidate(): void {
      cached = null;
    },
  };
}

export type PlayableTitles = ReturnType<typeof createPlayableTitles>;
