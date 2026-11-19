import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTitleAvailability,
  type TitleAssociationRecord,
  type TitleQuery,
} from "./title-availability";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const MOVIE: TitleQuery = {
  tmdbId: 10378,
  mediaType: "MOVIE",
  seasonNumber: 0,
  episodeNumber: 0,
};

function association(
  overrides: Partial<TitleAssociationRecord> = {},
): TitleAssociationRecord {
  return {
    id: "a1",
    provider: "archive",
    rightsStatus: "VERIFIED",
    availabilityStatus: "UNKNOWN",
    lastVerifiedAt: null,
    ...overrides,
  };
}

/** In-memory store whose `verify` behaves like the real one (writes status + date). */
function setup(initial: TitleAssociationRecord[], verifyResult: "AVAILABLE" | "UNAVAILABLE") {
  let clock = NOW;
  const rows = new Map(initial.map((row) => [row.id, row]));
  const verified: string[] = [];
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;

  const service = createTitleAvailability({
    loadVerified: async () => [...rows.values()],
    verify: async (id) => {
      verified.push(id);
      if (gate) {
        await gate;
      }
      const row = rows.get(id);
      if (!row) {
        throw new Error("sumiu");
      }
      rows.set(id, {
        ...row,
        availabilityStatus: verifyResult,
        lastVerifiedAt: new Date(clock),
      });
    },
    now: () => clock,
    freshHours: () => 48,
  });

  return {
    service,
    rows,
    verified,
    advance: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release?.(),
  };
}

describe("createTitleAvailability", () => {
  it("answers from stored data without touching any provider", async () => {
    const env = setup([association()], "AVAILABLE");
    const result = await env.service.get(MOVIE);

    assert.equal(result.state, "UNKNOWN");
    assert.equal(result.checkedLive, false);
    assert.equal(result.type, "movie");
    assert.deepEqual(result.providers, [
      { provider: "archive", availabilityStatus: "UNKNOWN", lastVerifiedAt: null },
    ]);
    assert.deepEqual(env.verified, []);
  });

  it("is NONE for a title without VERIFIED associations", async () => {
    const env = setup([], "AVAILABLE");
    const result = await env.service.get(MOVIE, { live: true });
    assert.equal(result.state, "NONE");
    assert.equal(result.checkedLive, false);
    assert.deepEqual(env.verified, []);
  });

  it("reports an episode query as type episode", async () => {
    const env = setup([], "AVAILABLE");
    const result = await env.service.get({ ...MOVIE, mediaType: "EPISODE", episodeNumber: 3 });
    assert.equal(result.type, "episode");
  });

  it("live check turns UNKNOWN into CONFIRMED and records the date", async () => {
    const env = setup([association()], "AVAILABLE");
    const result = await env.service.get(MOVIE, { live: true });

    assert.equal(result.checkedLive, true);
    assert.equal(result.state, "CONFIRMED");
    assert.deepEqual(env.verified, ["a1"]);
    assert.equal(result.providers[0].availabilityStatus, "AVAILABLE");
    assert.equal(result.providers[0].lastVerifiedAt, new Date(NOW).toISOString());
  });

  it("live check turns a dead source into UNAVAILABLE", async () => {
    const env = setup([association()], "UNAVAILABLE");
    const result = await env.service.get(MOVIE, { live: true });
    assert.equal(result.state, "UNAVAILABLE");
    assert.equal(result.checkedLive, true);
  });

  it("also re-checks associations already flagged UNAVAILABLE so they can recover", async () => {
    const env = setup(
      [association({ availabilityStatus: "UNAVAILABLE", lastVerifiedAt: new Date(NOW - HOUR) })],
      "AVAILABLE",
    );
    const result = await env.service.get(MOVIE, { live: true });
    assert.equal(result.state, "CONFIRMED");
  });

  it("allows one live check per title per minute", async () => {
    const env = setup([association()], "AVAILABLE");

    const first = await env.service.get(MOVIE, { live: true });
    env.advance(30_000);
    const second = await env.service.get(MOVIE, { live: true });

    assert.equal(first.checkedLive, true);
    assert.equal(second.checkedLive, false);
    assert.equal(second.state, "CONFIRMED");
    assert.deepEqual(env.verified, ["a1"]);

    env.advance(31_000);
    const third = await env.service.get(MOVIE, { live: true });
    assert.equal(third.checkedLive, true);
    assert.deepEqual(env.verified, ["a1", "a1"]);
  });

  it("throttles per title, not globally", async () => {
    const env = setup([association()], "AVAILABLE");
    await env.service.get(MOVIE, { live: true });
    const other = await env.service.get({ ...MOVIE, tmdbId: 1 }, { live: true });
    // Same fake store answers both, but each title has its own throttle slot.
    assert.equal(other.checkedLive, true);
    assert.equal(env.verified.length, 2);
  });

  it("concurrent callers share one check", async () => {
    const env = setup([association()], "AVAILABLE");
    env.hold();

    const first = env.service.get(MOVIE, { live: true });
    const second = env.service.get(MOVIE, { live: true });
    // Let both reach the gate before releasing the provider.
    await new Promise((resolve) => setImmediate(resolve));
    env.release();
    const [a, b] = await Promise.all([first, second]);

    assert.deepEqual(env.verified, ["a1"]);
    assert.equal(a.checkedLive, true);
    assert.equal(b.checkedLive, true);
    assert.equal(b.state, "CONFIRMED");
  });

  it("one association failing does not hide the other's result", async () => {
    const env = setup(
      [association({ id: "gone" }), association({ id: "ok", provider: "peertube" })],
      "AVAILABLE",
    );
    const originalGet = env.rows.get.bind(env.rows);
    env.rows.get = (id: string) => (id === "gone" ? undefined : originalGet(id));

    const result = await env.service.get(MOVIE, { live: true });
    assert.equal(result.checkedLive, true);
    assert.equal(result.state, "CONFIRMED");
  });

  it("caps how many associations one request checks", async () => {
    const many = Array.from({ length: 9 }, (_, index) => association({ id: `a${index}` }));
    const env = setup(many, "AVAILABLE");
    await env.service.get(MOVIE, { live: true });
    assert.equal(env.verified.length, 5);
  });

  it("never exposes anything but provider id, status and date", async () => {
    const env = setup([association()], "AVAILABLE");
    const result = await env.service.get(MOVIE, { live: true });
    assert.deepEqual(Object.keys(result.providers[0]).sort(), [
      "availabilityStatus",
      "lastVerifiedAt",
      "provider",
    ]);
  });
});
