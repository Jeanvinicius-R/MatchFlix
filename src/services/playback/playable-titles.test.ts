import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlayableLookup,
  createPlayableTitles,
  type PlayableTitleRecord,
} from "./playable-titles";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00.000Z");

function record(overrides: Partial<PlayableTitleRecord> = {}): PlayableTitleRecord {
  return {
    tmdbId: 10378,
    mediaType: "MOVIE",
    rightsStatus: "VERIFIED",
    availabilityStatus: "AVAILABLE",
    lastVerifiedAt: new Date(NOW - HOUR),
    ...overrides,
  };
}

describe("buildPlayableLookup", () => {
  it("marks a confirmed movie and nothing else", () => {
    const lookup = buildPlayableLookup([record()], NOW, 48);
    assert.equal(lookup.hasMovie(10378), true);
    assert.equal(lookup.hasMovie(1), false);
    assert.equal(lookup.hasSeries(10378), false);
  });

  it("never counts a VERIFIED association that was not confirmed", () => {
    const rows = [
      record({ tmdbId: 1, availabilityStatus: "UNKNOWN", lastVerifiedAt: null }),
      record({ tmdbId: 2, availabilityStatus: "UNAVAILABLE" }),
      record({ tmdbId: 3, lastVerifiedAt: new Date(NOW - 100 * HOUR) }),
      record({ tmdbId: 4, rightsStatus: "REVOKED" }),
    ];
    const lookup = buildPlayableLookup(rows, NOW, 48);
    for (const id of [1, 2, 3, 4]) {
      assert.equal(lookup.hasMovie(id), false, `movie ${id}`);
    }
  });

  it("counts a series when any episode is confirmed", () => {
    const rows = [
      record({ tmdbId: 77, mediaType: "EPISODE", availabilityStatus: "UNAVAILABLE" }),
      record({ tmdbId: 77, mediaType: "EPISODE" }),
    ];
    const lookup = buildPlayableLookup(rows, NOW, 48);
    assert.equal(lookup.hasSeries(77), true);
    assert.equal(lookup.hasMovie(77), false);
  });

  it("answers false for a title without a TMDB id", () => {
    const lookup = buildPlayableLookup([record()], NOW, 48);
    assert.equal(lookup.hasMovie(null), false);
    assert.equal(lookup.hasSeries(null), false);
  });

  it("uses the freshness window it is given", () => {
    const rows = [record({ lastVerifiedAt: new Date(NOW - 10 * HOUR) })];
    assert.equal(buildPlayableLookup(rows, NOW, 12).hasMovie(10378), true);
    assert.equal(buildPlayableLookup(rows, NOW, 6).hasMovie(10378), false);
  });
});

describe("createPlayableTitles", () => {
  function setup(loader: () => Promise<PlayableTitleRecord[]>) {
    let clock = NOW;
    let calls = 0;
    const titles = createPlayableTitles({
      loadRecords: () => {
        calls += 1;
        return loader();
      },
      now: () => clock,
      freshHours: () => 48,
    });
    return {
      titles,
      calls: () => calls,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("caches for 30 seconds, then reloads", async () => {
    const env = setup(async () => [record()]);

    assert.equal((await env.titles.get())?.hasMovie(10378), true);
    env.advance(29_000);
    await env.titles.get();
    assert.equal(env.calls(), 1);

    env.advance(2_000);
    await env.titles.get();
    assert.equal(env.calls(), 2);
  });

  it("shares one query between concurrent callers", async () => {
    const env = setup(async () => [record()]);
    await Promise.all([env.titles.get(), env.titles.get(), env.titles.get()]);
    assert.equal(env.calls(), 1);
  });

  it("returns null when the database fails, and does not cache the failure", async () => {
    let failing = true;
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const env = setup(async () => {
        if (failing) {
          throw new Error("db down");
        }
        return [record()];
      });

      assert.equal(await env.titles.get(), null);
      failing = false;
      assert.equal((await env.titles.get())?.hasMovie(10378), true);
      assert.equal(env.calls(), 2);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("invalidate forces a reload", async () => {
    const env = setup(async () => [record()]);
    await env.titles.get();
    env.titles.invalidate();
    await env.titles.get();
    assert.equal(env.calls(), 2);
  });

  it("ages a confirmation out as the clock moves past the window", async () => {
    const env = setup(async () => [record({ lastVerifiedAt: new Date(NOW - 47 * HOUR) })]);
    assert.equal((await env.titles.get())?.hasMovie(10378), true);
    env.advance(2 * HOUR);
    assert.equal((await env.titles.get())?.hasMovie(10378), false);
  });
});
