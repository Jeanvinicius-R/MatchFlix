import {
  computeAvailabilityState,
  getFreshHours,
  type AvailabilityRecord,
  type AvailabilityState,
} from "./availability-state";

/**
 * Availability of ONE title for the player page: the stored state (database
 * only) plus, on request, a live re-check of its VERIFIED associations so the
 * answer is real before anybody presses play. Dependencies are injected
 * (default instance: src/services/playback-availability.service.ts).
 *
 * The live check is rate-limited per title and per process: viewers cannot use
 * this endpoint to hammer a provider.
 */

export interface TitleQuery {
  tmdbId: number;
  mediaType: "MOVIE" | "EPISODE";
  seasonNumber: number;
  episodeNumber: number;
}

export interface TitleAssociationRecord extends AvailabilityRecord {
  id: string;
  provider: string;
}

export interface TitleAvailability {
  tmdbId: number;
  type: "movie" | "episode";
  state: AvailabilityState;
  providers: {
    provider: string;
    availabilityStatus: AvailabilityRecord["availabilityStatus"];
    lastVerifiedAt: string | null;
  }[];
  /** True when this response includes a check made just now (by us or a concurrent caller). */
  checkedLive: boolean;
}

export interface TitleAvailabilityDeps {
  /** VERIFIED associations of the title, UNAVAILABLE ones included. */
  loadVerified: (query: TitleQuery) => Promise<readonly TitleAssociationRecord[]>;
  /** Runs the adapter against the provider and stores AVAILABLE/UNAVAILABLE + the date. */
  verify: (associationId: string) => Promise<unknown>;
  /** Epoch milliseconds. */
  now?: () => number;
  freshHours?: () => number;
  /** At most one live check per title in this window. Default 60 s. */
  minIntervalMs?: number;
  /** Associations checked per request (a title rarely has more than a couple). */
  maxLiveChecks?: number;
}

export const LIVE_CHECK_MIN_INTERVAL_MS = 60_000;
const DEFAULT_MAX_LIVE_CHECKS = 5;
/** Bound on the per-title throttle table (a long-running process, many titles). */
const MAX_TRACKED_TITLES = 2_000;

function titleKey(query: TitleQuery): string {
  return [query.mediaType, query.tmdbId, query.seasonNumber, query.episodeNumber].join(":");
}

export function createTitleAvailability(deps: TitleAvailabilityDeps) {
  const now = deps.now ?? (() => Date.now());
  const freshHours = deps.freshHours ?? getFreshHours;
  const minIntervalMs = deps.minIntervalMs ?? LIVE_CHECK_MIN_INTERVAL_MS;
  const maxLiveChecks = deps.maxLiveChecks ?? DEFAULT_MAX_LIVE_CHECKS;

  const lastCheckAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();

  function pruneThrottleTable(at: number): void {
    if (lastCheckAt.size < MAX_TRACKED_TITLES) {
      return;
    }
    for (const [key, startedAt] of lastCheckAt) {
      if (at - startedAt >= minIntervalMs && !inFlight.has(key)) {
        lastCheckAt.delete(key);
      }
    }
  }

  async function runLiveCheck(records: readonly TitleAssociationRecord[]): Promise<void> {
    const targets = records.slice(0, maxLiveChecks);
    // One association failing (or vanishing) must not hide the others' result.
    await Promise.allSettled(targets.map((record) => deps.verify(record.id)));
  }

  function view(
    query: TitleQuery,
    records: readonly TitleAssociationRecord[],
    checkedLive: boolean,
  ): TitleAvailability {
    return {
      tmdbId: query.tmdbId,
      type: query.mediaType === "MOVIE" ? "movie" : "episode",
      state: computeAvailabilityState(records, now(), freshHours()),
      providers: records.map((record) => ({
        provider: record.provider,
        availabilityStatus: record.availabilityStatus,
        lastVerifiedAt: record.lastVerifiedAt ? record.lastVerifiedAt.toISOString() : null,
      })),
      checkedLive,
    };
  }

  return {
    /**
     * Stored state; with `live`, first re-checks the VERIFIED associations
     * (unless this title was checked in the last minute, in which case the
     * stored state is returned with checkedLive false).
     */
    async get(query: TitleQuery, options: { live?: boolean } = {}): Promise<TitleAvailability> {
      let records = await deps.loadVerified(query);
      if (!options.live || records.length === 0) {
        return view(query, records, false);
      }

      const key = titleKey(query);
      const running = inFlight.get(key);
      let checkedLive = false;

      if (running) {
        // Somebody is already checking this title: share their result.
        await running;
        checkedLive = true;
      } else {
        const at = now();
        const previous = lastCheckAt.get(key);
        if (previous === undefined || at - previous >= minIntervalMs) {
          pruneThrottleTable(at);
          lastCheckAt.set(key, at);
          const check = runLiveCheck(records).finally(() => {
            inFlight.delete(key);
          });
          inFlight.set(key, check);
          await check;
          checkedLive = true;
        }
      }

      if (checkedLive) {
        records = await deps.loadVerified(query);
      }
      return view(query, records, checkedLive);
    },
  };
}

export type TitleAvailabilityService = ReturnType<typeof createTitleAvailability>;
