import { findVerifiedAvailabilityRecords } from "@/repositories/playback-availability.repository";
import { createPlayableTitles } from "./playable-titles";

/** Default instance: Prisma-backed, shared by every catalog query in this process. */
export const playableTitles = createPlayableTitles({
  loadRecords: findVerifiedAvailabilityRecords,
});

/** The lookup for the cards, or null when the database failed (old behaviour then). */
export function getPlayableLookup() {
  return playableTitles.get();
}

/**
 * Wraps a write (approval, revocation, removal, re-check) so the card badges
 * are recomputed right after it instead of lagging behind for the cache TTL.
 */
export function invalidatingPlayable<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await action(...args);
    } finally {
      playableTitles.invalidate();
    }
  };
}
