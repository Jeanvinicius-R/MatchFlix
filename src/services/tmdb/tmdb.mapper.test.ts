import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapExternalIds, mapFindResult } from "./tmdb.mapper";

describe("mapExternalIds", () => {
  it("returns a well-formed imdb id, lowercased and trimmed", () => {
    assert.deepEqual(mapExternalIds({ id: 1, imdb_id: " TT1254207 " }), {
      imdbId: "tt1254207",
    });
  });

  it("turns anything else into null", () => {
    for (const imdb_id of [null, undefined, "", "   ", "1254207", "nm0000001", "tt12"]) {
      assert.deepEqual(mapExternalIds({ id: 1, imdb_id }), { imdbId: null });
    }
  });
});

describe("mapFindResult", () => {
  it("takes the first movie and the first series", () => {
    assert.deepEqual(
      mapFindResult({
        movie_results: [{ id: 10378 }, { id: 2 }],
        tv_results: [{ id: 1399 }],
      }),
      { movieId: 10378, seriesId: 1399 },
    );
  });

  it("leaves a key out when TMDB has no such title", () => {
    assert.deepEqual(mapFindResult({ movie_results: [], tv_results: [{ id: 7 }] }), {
      seriesId: 7,
    });
    assert.deepEqual(mapFindResult({}), {});
  });
});
