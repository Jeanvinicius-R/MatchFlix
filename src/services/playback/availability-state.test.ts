import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FRESH_HOURS,
  computeAvailabilityState,
  isConfirmed,
  isFreshCheck,
  parseFreshHours,
  type AvailabilityRecord,
} from "./availability-state";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00.000Z");

function record(overrides: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return {
    rightsStatus: "VERIFIED",
    availabilityStatus: "AVAILABLE",
    lastVerifiedAt: new Date(NOW - HOUR),
    ...overrides,
  };
}

describe("computeAvailabilityState", () => {
  it("is NONE without any association", () => {
    assert.equal(computeAvailabilityState([], NOW), "NONE");
  });

  it("is NONE when no association is VERIFIED", () => {
    const rows = [
      record({ rightsStatus: "UNVERIFIED" }),
      record({ rightsStatus: "REVOKED" }),
      record({ rightsStatus: "EXPIRED" }),
    ];
    assert.equal(computeAvailabilityState(rows, NOW), "NONE");
  });

  it("is CONFIRMED for a VERIFIED, AVAILABLE and recently checked association", () => {
    assert.equal(computeAvailabilityState([record()], NOW), "CONFIRMED");
  });

  it("is UNKNOWN when it was never checked", () => {
    const rows = [record({ availabilityStatus: "UNKNOWN", lastVerifiedAt: null })];
    assert.equal(computeAvailabilityState(rows, NOW), "UNKNOWN");
  });

  it("is UNKNOWN for AVAILABLE without a check date", () => {
    const rows = [record({ lastVerifiedAt: null })];
    assert.equal(computeAvailabilityState(rows, NOW), "UNKNOWN");
  });

  it("is UNKNOWN when the status is UNKNOWN even with a recent date", () => {
    const rows = [record({ availabilityStatus: "UNKNOWN" })];
    assert.equal(computeAvailabilityState(rows, NOW), "UNKNOWN");
  });

  it("is UNKNOWN when the last good check is older than the window", () => {
    const stale = [record({ lastVerifiedAt: new Date(NOW - 49 * HOUR) })];
    assert.equal(computeAvailabilityState(stale, NOW), "UNKNOWN");
  });

  it("treats the window edge as fresh and just past it as stale", () => {
    const edge = [record({ lastVerifiedAt: new Date(NOW - 48 * HOUR) })];
    const past = [record({ lastVerifiedAt: new Date(NOW - 48 * HOUR - 1) })];
    assert.equal(computeAvailabilityState(edge, NOW, 48), "CONFIRMED");
    assert.equal(computeAvailabilityState(past, NOW, 48), "UNKNOWN");
  });

  it("honours a custom freshness window", () => {
    const rows = [record({ lastVerifiedAt: new Date(NOW - 5 * HOUR) })];
    assert.equal(computeAvailabilityState(rows, NOW, 6), "CONFIRMED");
    assert.equal(computeAvailabilityState(rows, NOW, 4), "UNKNOWN");
  });

  it("does not trust a check dated in the future", () => {
    const rows = [record({ lastVerifiedAt: new Date(NOW + HOUR) })];
    assert.equal(computeAvailabilityState(rows, NOW), "UNKNOWN");
  });

  it("is UNAVAILABLE only when every VERIFIED association is UNAVAILABLE", () => {
    const rows = [
      record({ availabilityStatus: "UNAVAILABLE" }),
      record({ availabilityStatus: "UNAVAILABLE", lastVerifiedAt: null }),
      record({ rightsStatus: "REVOKED", availabilityStatus: "AVAILABLE" }),
    ];
    assert.equal(computeAvailabilityState(rows, NOW), "UNAVAILABLE");
  });

  it("is UNKNOWN when one failed and another was never checked", () => {
    const rows = [
      record({ availabilityStatus: "UNAVAILABLE" }),
      record({ availabilityStatus: "UNKNOWN", lastVerifiedAt: null }),
    ];
    assert.equal(computeAvailabilityState(rows, NOW), "UNKNOWN");
  });

  it("is CONFIRMED when one source works even if another failed", () => {
    const rows = [record({ availabilityStatus: "UNAVAILABLE" }), record()];
    assert.equal(computeAvailabilityState(rows, NOW), "CONFIRMED");
  });

  it("ignores a revoked association that was AVAILABLE", () => {
    const rows = [record({ rightsStatus: "REVOKED" })];
    assert.equal(computeAvailabilityState(rows, NOW), "NONE");
  });
});

describe("isConfirmed", () => {
  it("only CONFIRMED may show the video badge", () => {
    assert.equal(isConfirmed("CONFIRMED"), true);
    assert.equal(isConfirmed("UNKNOWN"), false);
    assert.equal(isConfirmed("UNAVAILABLE"), false);
    assert.equal(isConfirmed("NONE"), false);
  });
});

describe("isFreshCheck", () => {
  it("is false without a date", () => {
    assert.equal(isFreshCheck(null, NOW, 48), false);
  });
});

describe("parseFreshHours", () => {
  it("defaults to 48 hours", () => {
    assert.equal(DEFAULT_FRESH_HOURS, 48);
    assert.equal(parseFreshHours(undefined), 48);
    assert.equal(parseFreshHours(""), 48);
    assert.equal(parseFreshHours("   "), 48);
  });

  it("accepts positive numbers, including fractions", () => {
    assert.equal(parseFreshHours("12"), 12);
    assert.equal(parseFreshHours(" 0.5 "), 0.5);
  });

  it("falls back on junk, zero and negatives", () => {
    assert.equal(parseFreshHours("abc"), 48);
    assert.equal(parseFreshHours("0"), 48);
    assert.equal(parseFreshHours("-3"), 48);
    assert.equal(parseFreshHours("Infinity"), 48);
  });

  it("caps absurd values at one year", () => {
    assert.equal(parseFreshHours("999999"), 24 * 365);
  });
});
