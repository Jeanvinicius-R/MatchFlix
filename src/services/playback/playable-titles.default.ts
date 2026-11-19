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
