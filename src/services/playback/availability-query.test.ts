import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAvailabilityQuery } from "./availability-query";

function parse(search: string) {
  return parseAvailabilityQuery(new URLSearchParams(search));
}

describe("parseAvailabilityQuery", () => {
  it("parses a movie", () => {
    assert.deepEqual(parse("tmdbId=10378&type=movie"), {
      ok: true,
      query: { tmdbId: 10378, mediaType: "MOVIE", seasonNumber: 0, episodeNumber: 0 },
      live: false,
    });
  });

  it("ignores season/episode for a movie", () => {
    const result = parse("tmdbId=10378&type=movie&season=4&episode=9");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.query.seasonNumber, 0);
      assert.equal(result.query.episodeNumber, 0);
    }
  });

  it("parses an episode, including season 0 (specials)", () => {
    const result = parse("tmdbId=1399&type=episode&season=0&episode=2");
    assert.deepEqual(result, {
      ok: true,
      query: { tmdbId: 1399, mediaType: "EPISODE", seasonNumber: 0, episodeNumber: 2 },
      live: false,
    });
  });

  it("only check=1 asks for a live check", () => {
    const live = parse("tmdbId=1&type=movie&check=1");
    assert.equal(live.ok && live.live, true);
    for (const value of ["0", "true", "yes", ""]) {
      const other = parse(`tmdbId=1&type=movie&check=${value}`);
      assert.equal(other.ok && other.live, false, value);
    }
  });

  it("rejects a bad or missing tmdbId", () => {
    for (const search of [
      "type=movie",
      "tmdbId=0&type=movie",
      "tmdbId=-4&type=movie",
      "tmdbId=1.5&type=movie",
      "tmdbId=abc&type=movie",
      "tmdbId=1e3&type=movie",
      "tmdbId=12345678901&type=movie",
    ]) {
      assert.equal(parse(search).ok, false, search);
    }
  });

  it("rejects an unknown or missing type", () => {
    assert.equal(parse("tmdbId=1").ok, false);
    assert.equal(parse("tmdbId=1&type=series").ok, false);
    assert.equal(parse("tmdbId=1&type=MOVIE").ok, false);
  });

  it("rejects an episode without valid season/episode", () => {
    for (const search of [
      "tmdbId=1&type=episode",
      "tmdbId=1&type=episode&season=1",
      "tmdbId=1&type=episode&episode=1",
      "tmdbId=1&type=episode&season=-1&episode=1",
      "tmdbId=1&type=episode&season=1&episode=0",
      "tmdbId=1&type=episode&season=x&episode=1",
    ]) {
      assert.equal(parse(search).ok, false, search);
    }
  });
});
