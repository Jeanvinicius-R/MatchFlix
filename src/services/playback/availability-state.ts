/**
 * Per-title availability, calculated from the VERIFIED associations of a title.
 *
 * Rights, matching and availability are independent checks: a title being in
 * the database says nothing about whether its video can be played right now.
 * This module only classifies how much we know. Pure on purpose (no Prisma, no
 * network) so the rules are unit-tested and shared by the cards, the
 * availability API and the periodic re-check.
 *
 *   NONE         no VERIFIED association at all
 *   CONFIRMED    a VERIFIED association was found AVAILABLE recently enough
 *   UNKNOWN      VERIFIED, but never checked, UNKNOWN, or the check is stale
 *   UNAVAILABLE  every VERIFIED association failed its last check
 */

export type AvailabilityState = "NONE" | "CONFIRMED" | "UNKNOWN" | "UNAVAILABLE";

export type RecordAvailabilityStatus = "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";

/** The few association columns the classification reads. */
export interface AvailabilityRecord {
  rightsStatus: string;
  availabilityStatus: RecordAvailabilityStatus;
  lastVerifiedAt: Date | null;
}

export const DEFAULT_FRESH_HOURS = 48;
/** A year: anything longer is a typo, and would make "fresh" meaningless. */
const MAX_FRESH_HOURS = 24 * 365;
const HOUR_MS = 60 * 60 * 1000;

/** Reads PLAYBACK_AVAILABILITY_FRESH_HOURS; anything invalid falls back to 48. */
export function parseFreshHours(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return DEFAULT_FRESH_HOURS;
  }
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_FRESH_HOURS;
  }
  return Math.min(hours, MAX_FRESH_HOURS);
}

/** Freshness window in hours, from the environment (read at call time). */
export function getFreshHours(): number {
  return parseFreshHours(process.env.PLAYBACK_AVAILABILITY_FRESH_HOURS);
}

/** True when `lastVerifiedAt` is inside the freshness window ending at `now`. */
export function isFreshCheck(
  lastVerifiedAt: Date | null,
  now: number,
  freshHours: number,
): boolean {
  if (!lastVerifiedAt) {
    return false;
  }
  const age = now - lastVerifiedAt.getTime();
  // A check "from the future" (clock skew) is not evidence of anything.
  return age >= 0 && age <= freshHours * HOUR_MS;
}

/**
 * Classifies a title from all its association rows (non-VERIFIED rows are
 * ignored). `now` is epoch milliseconds, injected so tests need no clock.
 */
export function computeAvailabilityState(
  records: readonly AvailabilityRecord[],
  now: number,
  freshHours: number = DEFAULT_FRESH_HOURS,
): AvailabilityState {
  const verified = records.filter((record) => record.rightsStatus === "VERIFIED");
  if (verified.length === 0) {
    return "NONE";
  }

  const confirmed = verified.some(
    (record) =>
      record.availabilityStatus === "AVAILABLE" &&
      isFreshCheck(record.lastVerifiedAt, now, freshHours),
  );
  if (confirmed) {
    return "CONFIRMED";
  }

  if (verified.every((record) => record.availabilityStatus === "UNAVAILABLE")) {
    return "UNAVAILABLE";
  }
  return "UNKNOWN";
}

/** Only CONFIRMED titles may show the "has video" badge on cards. */
export function isConfirmed(state: AvailabilityState): boolean {
  return state === "CONFIRMED";
}
