import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryQuery, ProviderCandidate } from "../adapters/adapter.types";
import {
  MAX_METADATA_SCORE,
  MIN_STORED_SCORE,
  normalizeTitle,
  scoreCandidate,
  similarity,
  type MatchableCandidate,
} from "./matcher";

const MOVIE_QUERY: DiscoveryQuery = {
  tmdbId: 10378,
  imdbId: "tt1254207",
  mediaType: "MOVIE",
  seasonNumber: 0,
  episodeNumber: 0,
  title: "Big Buck Bunny",
  originalTitle: "Big Buck Bunny",
  year: 2008,
  runtimeMinutes: 10,
};

const EPISODE_QUERY: DiscoveryQuery = {
  tmdbId: 1399,
  imdbId: "tt0944947",
  mediaType: "EPISODE",
  seasonNumber: 2,
  episodeNumber: 5,
  title: "A Guerra dos Tronos",
  originalTitle: "Game of Thrones",
  year: 2011,
  runtimeMinutes: 55,
};

function candidate(overrides: Partial<MatchableCandidate> = {}): MatchableCandidate {
  return { providerAssetId: "asset-1", title: "Big Buck Bunny", year: 2008, ...overrides };
}

describe("normalizeTitle", () => {
  const cases: [string, string][] = [
    ["Big Buck Bunny", "big buck bunny"],
    ["  BIG   BUCK\tBUNNY  ", "big buck bunny"],
    ["Ação & Aventura!", "acao aventura"],
    ["Amélie Poulain", "amelie poulain"],
    ["O Senhor dos Anéis", "senhor dos aneis"],
    ["Os Vingadores", "vingadores"],
    ["Um Sonho de Liberdade", "sonho de liberdade"],
    ["Uma Linda Mulher", "linda mulher"],
    ["The Matrix", "matrix"],
    ["A Fuga das Galinhas", "fuga das galinhas"],
    ["An American Tail", "american tail"],
    ["Avatar (2009)", "avatar"],
    ["Avatar [HD]", "avatar"],
    ["Avatar (2009) [1080p]", "avatar"],
    ["Avatar [Dublado] (2009)", "avatar"],
    ["Mission: Impossible - Fallout", "mission impossible fallout"],
    ["Spider-Man: No Way Home", "spider man no way home"],
    ["Alien (Director's Cut)", "alien director s cut"],
    ["Blade Runner 2049", "blade runner 2049"],
    ["1917", "1917"],
    ["2001: Uma Odisseia no Espaço", "2001 uma odisseia no espaco"],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" -> "${expected}"`, () => {
      assert.equal(normalizeTitle(input), expected);
    });
  }

  it("keeps a title that is only an article or only a tag", () => {
    assert.equal(normalizeTitle("A"), "a");
    assert.equal(normalizeTitle("The"), "the");
    assert.equal(normalizeTitle("(2019)"), "2019");
  });

  it("strips only one leading article", () => {
    assert.equal(normalizeTitle("The A Team"), "a team");
  });

  it("does not strip an article glued to a word", () => {
    assert.equal(normalizeTitle("Another Round"), "another round");
    assert.equal(normalizeTitle("Ouro Negro"), "ouro negro");
  });

  it("keeps non-latin letters", () => {
    assert.equal(normalizeTitle("千と千尋の神隠し"), "千と千尋の神隠し");
  });

  it("is empty for blank input", () => {
    assert.equal(normalizeTitle(""), "");
    assert.equal(normalizeTitle("  !!!  "), "");
  });
});

describe("similarity", () => {
  it("is 1 for titles that normalize alike", () => {
    assert.equal(similarity("The Matrix (1999)", "matrix"), 1);
    assert.equal(similarity("AMÉLIE", "amelie"), 1);
  });

  it("is 0 for blank or unrelated input", () => {
    assert.equal(similarity("", "matrix"), 0);
    assert.equal(similarity("matrix", ""), 0);
    assert.equal(similarity("xxxx", "yyyy"), 0);
  });

  it("is 0 for a single character that differs", () => {
    assert.equal(similarity("x", "y"), 0);
  });

  it("is high for a one-letter typo in a long title and low for different films", () => {
    assert.ok(
      similarity("Indiana Jones and the Last Crusade", "Indiana Jones and the Last Crusades") >=
        0.92,
    );
    assert.ok(similarity("Toy Story", "Toy Story 4") < 0.92);
    assert.ok(similarity("Alien", "Aliens") < 0.92);
    assert.ok(similarity("Big Buck Bunny", "Sintel") < 0.3);
  });

  it("is symmetric and within 0..1", () => {
    const pairs: [string, string][] = [
      ["Big Buck Bunny", "Big Bunny"],
      ["Sintel", "Sintel Trailer"],
      ["a b c", "c b a"],
    ];

    for (const [a, b] of pairs) {
      const value = similarity(a, b);
      assert.equal(value, similarity(b, a));
      assert.ok(value >= 0 && value <= 1);
    }
  });

  it("counts repeated bigrams only as often as both sides have them", () => {
    // "aaaa" has bigram "aa" x3; "aa" has it x1: 2*1 / (3+1) = 0.5
    assert.equal(similarity("aaaa", "aa"), 0.5);
  });
});

describe("scoreCandidate: identifiers", () => {
  it("scores 100 when the provider declares the tmdb id", () => {
    const result = scoreCandidate(
      MOVIE_QUERY,
      candidate({ title: "Qualquer coisa", year: 1999, externalIds: { tmdb: 10378 } }),
    );

    assert.equal(result?.method, "TMDB_ID");
    assert.equal(result?.score, 100);
    assert.equal(result?.reason, "O provedor declara tmdb_id 10378.");
  });

  it("scores 98 when the provider declares the imdb id", () => {
    const result = scoreCandidate(
      MOVIE_QUERY,
      candidate({ title: "Outro nome", year: undefined, externalIds: { imdb: "tt1254207" } }),
    );

    assert.equal(result?.method, "IMDB_ID");
    assert.equal(result?.score, 98);
    assert.equal(result?.reason, "O provedor declara imdb_id tt1254207.");
  });

  it("prefers the tmdb id when both match", () => {
    const result = scoreCandidate(
      MOVIE_QUERY,
      candidate({ externalIds: { tmdb: 10378, imdb: "tt1254207" } }),
    );

    assert.equal(result?.method, "TMDB_ID");
    assert.equal(result?.score, 100);
  });

  it("compares imdb ids ignoring case and blanks", () => {
    const result = scoreCandidate(
      MOVIE_QUERY,
      candidate({ title: "x", externalIds: { imdb: "  TT1254207 " } }),
    );

    assert.equal(result?.method, "IMDB_ID");
  });

  it("discards a candidate that declares ANOTHER tmdb id, even with a perfect title", () => {
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ externalIds: { tmdb: 999 } })), null);
  });

  it("discards a candidate that declares ANOTHER imdb id, even with a perfect title", () => {
    assert.equal(
      scoreCandidate(MOVIE_QUERY, candidate({ externalIds: { imdb: "tt0000001" } })),
      null,
    );
  });

  it("discards a tmdb match that conflicts on the imdb id", () => {
    assert.equal(
      scoreCandidate(
        MOVIE_QUERY,
        candidate({ externalIds: { tmdb: 10378, imdb: "tt0000001" } }),
      ),
      null,
    );
  });

  it("falls back to metadata when the query has no imdb id to compare", () => {
    const query: DiscoveryQuery = { ...MOVIE_QUERY, imdbId: undefined };
    const result = scoreCandidate(query, candidate({ externalIds: { imdb: "tt1254207" } }));

    assert.equal(result?.method, "METADATA");
  });

  it("ignores malformed identifiers instead of trusting them", () => {
    const result = scoreCandidate(
      MOVIE_QUERY,
      candidate({
        title: "Totally Different",
        externalIds: { tmdb: -5, imdb: "not-an-id" },
      }),
    );

    assert.equal(result, null);
    assert.equal(
      scoreCandidate(MOVIE_QUERY, candidate({ externalIds: { tmdb: 10378.5 } }))?.method,
      "METADATA",
    );
  });
});

describe("scoreCandidate: metadata", () => {
  it("scores 80 for the same title and year", () => {
    const result = scoreCandidate(MOVIE_QUERY, candidate());

    assert.equal(result?.method, "METADATA");
    assert.equal(result?.score, 80);
    assert.match(result?.reason ?? "", /Título igual \("Big Buck Bunny"\) e mesmo ano \(2008\)/);
    assert.match(result?.reason ?? "", /confira antes de aprovar/);
  });

  it("matches on the original title, ignoring accents, articles and tags", () => {
    const query: DiscoveryQuery = {
      ...MOVIE_QUERY,
      title: "A Fuga das Galinhas",
      originalTitle: "Chicken Run",
      year: 2000,
      runtimeMinutes: undefined,
    };

    for (const title of ["Chicken Run (2000) [HD]", "chicken run", "A Fuga das Galinhas"]) {
      const result = scoreCandidate(query, candidate({ title, year: 2000 }));
      assert.equal(result?.score, 80, title);
    }
  });

  it("discards a year that is off by one (65, below the minimum)", () => {
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ year: 2007 })), null);
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ year: 2009 })), null);
  });

  it("discards a year that is off by one even with a matching runtime", () => {
    assert.equal(
      scoreCandidate(MOVIE_QUERY, candidate({ year: 2009, durationMinutes: 10 })),
      null,
    );
  });

  it("discards a clearly different year", () => {
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ year: 1995 })), null);
  });

  it("discards when either side has no year", () => {
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ year: undefined })), null);
    assert.equal(
      scoreCandidate({ ...MOVIE_QUERY, year: undefined }, candidate()),
      null,
    );
  });

  it("scores 72 for a near-identical title with the same year", () => {
    const query: DiscoveryQuery = {
      ...MOVIE_QUERY,
      title: "Indiana Jones and the Last Crusade",
      originalTitle: undefined,
      year: 1989,
      runtimeMinutes: undefined,
    };
    const result = scoreCandidate(
      query,
      candidate({ title: "Indiana Jones and the Last Crusades", year: 1989 }),
    );

    assert.equal(result?.method, "METADATA");
    assert.equal(result?.score, 72);
    assert.match(result?.reason ?? "", /Título muito parecido/);
    assert.match(result?.reason ?? "", /similaridade/);
  });

  it("does not accept a similar title when the year differs", () => {
    const query: DiscoveryQuery = {
      ...MOVIE_QUERY,
      title: "Indiana Jones and the Last Crusade",
      originalTitle: undefined,
      year: 1989,
    };

    assert.equal(
      scoreCandidate(
        query,
        candidate({ title: "Indiana Jones and the Last Crusades", year: 1990 }),
      ),
      null,
    );
  });

  it("does not accept sequels or spin-offs as the same title", () => {
    const query: DiscoveryQuery = {
      ...MOVIE_QUERY,
      title: "Toy Story",
      originalTitle: "Toy Story",
      year: 1995,
      runtimeMinutes: undefined,
    };

    assert.equal(scoreCandidate(query, candidate({ title: "Toy Story 4", year: 1995 })), null);
    assert.equal(scoreCandidate(query, candidate({ title: "Alien", year: 1995 })), null);
  });

  it("adds 8 when the duration is within 10% of the runtime", () => {
    const result = scoreCandidate(MOVIE_QUERY, candidate({ durationMinutes: 10.9 }));

    assert.equal(result?.score, 88);
    assert.match(result?.reason ?? "", /Duração compatível/);
  });

  it("accepts the exact 10% boundary and rejects just beyond it", () => {
    const query: DiscoveryQuery = { ...MOVIE_QUERY, runtimeMinutes: 100 };

    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 110 }))?.score, 88);
    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 90 }))?.score, 88);
    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 111 }))?.score, 80);
  });

  it("gives no bonus (but keeps the match) for a moderately different duration", () => {
    const query: DiscoveryQuery = { ...MOVIE_QUERY, runtimeMinutes: 100 };

    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 130 }))?.score, 80);
  });

  it("discards a candidate whose duration is wildly different (trailer, extra)", () => {
    const query: DiscoveryQuery = { ...MOVIE_QUERY, runtimeMinutes: 100 };

    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 2 })), null);
    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 400 })), null);
  });

  it("ignores durations when the query has none", () => {
    const query: DiscoveryQuery = { ...MOVIE_QUERY, runtimeMinutes: undefined };

    assert.equal(scoreCandidate(query, candidate({ durationMinutes: 2 }))?.score, 80);
  });

  it("scores the similar-title match plus the duration bonus as 80", () => {
    const query: DiscoveryQuery = {
      ...MOVIE_QUERY,
      title: "Indiana Jones and the Last Crusade",
      originalTitle: undefined,
      year: 1989,
      runtimeMinutes: 127,
    };
    const result = scoreCandidate(
      query,
      candidate({
        title: "Indiana Jones and the Last Crusades",
        year: 1989,
        durationMinutes: 125,
      }),
    );

    assert.equal(result?.score, 80);
  });

  it("never reaches identifier territory", () => {
    const best = scoreCandidate(MOVIE_QUERY, candidate({ durationMinutes: 10 }));

    assert.ok(best);
    assert.ok(best.score <= MAX_METADATA_SCORE);
    assert.ok(best.score >= MIN_STORED_SCORE);
    assert.equal(best.method, "METADATA");
  });

  it("uses the pt-BR title when the original differs", () => {
    const query: DiscoveryQuery = {
      ...MOVIE_QUERY,
      title: "O Rei Leão",
      originalTitle: "The Lion King",
      year: 1994,
      runtimeMinutes: undefined,
    };

    assert.equal(scoreCandidate(query, candidate({ title: "Rei Leao", year: 1994 }))?.score, 80);
    assert.equal(scoreCandidate(query, candidate({ title: "Lion King", year: 1994 }))?.score, 80);
  });

  it("returns null for blank titles", () => {
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ title: "  !!  " })), null);
    assert.equal(scoreCandidate({ ...MOVIE_QUERY, title: "", originalTitle: "" }, candidate()), null);
  });

  it("treats a non-positive year as unknown", () => {
    assert.equal(scoreCandidate(MOVIE_QUERY, candidate({ year: 0 })), null);
  });
});

describe("scoreCandidate: movie versus episode", () => {
  it("discards a catalog episode for a movie query and vice versa", () => {
    const episodeItem: MatchableCandidate = candidate({
      mediaType: "EPISODE",
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { tmdb: 10378 },
    });
    const movieItem: MatchableCandidate = candidate({
      mediaType: "MOVIE",
      externalIds: { tmdb: 1399 },
    });

    assert.equal(scoreCandidate(MOVIE_QUERY, episodeItem), null);
    assert.equal(scoreCandidate(EPISODE_QUERY, movieItem), null);
  });

  it("accepts a catalog movie for a movie query", () => {
    const result = scoreCandidate(
      MOVIE_QUERY,
      candidate({ mediaType: "MOVIE", externalIds: { tmdb: 10378 } }),
    );

    assert.equal(result?.score, 100);
  });
});

describe("scoreCandidate: episodes", () => {
  function episodeItem(overrides: Partial<MatchableCandidate> = {}): MatchableCandidate {
    return {
      providerAssetId: "series:7:2:5",
      title: "The Kingsroad",
      seriesTitle: "Game of Thrones",
      mediaType: "EPISODE",
      seasonNumber: 2,
      episodeNumber: 5,
      year: 2011,
      ...overrides,
    };
  }

  it("needs the same season and episode", () => {
    const withId = { externalIds: { tmdb: 1399 } };

    assert.equal(scoreCandidate(EPISODE_QUERY, episodeItem(withId))?.score, 100);
    assert.equal(scoreCandidate(EPISODE_QUERY, episodeItem({ ...withId, seasonNumber: 3 })), null);
    assert.equal(
      scoreCandidate(EPISODE_QUERY, episodeItem({ ...withId, episodeNumber: 6 })),
      null,
    );
  });

  it("refuses a candidate that does not say which episode it is (fail closed)", () => {
    const bare: ProviderCandidate = {
      providerAssetId: "series:7",
      title: "Game of Thrones",
      year: 2011,
      externalIds: { tmdb: 1399 },
    };

    assert.equal(scoreCandidate(EPISODE_QUERY, bare), null);
    assert.equal(
      scoreCandidate(EPISODE_QUERY, episodeItem({ seasonNumber: undefined, externalIds: { tmdb: 1399 } })),
      null,
    );
  });

  it("explains the episode in the reason", () => {
    const result = scoreCandidate(EPISODE_QUERY, episodeItem({ externalIds: { tmdb: 1399 } }));

    assert.equal(
      result?.reason,
      "O provedor declara tmdb_id 1399 (temporada 2, episódio 5).",
    );
  });

  it("scores by imdb id for an episode", () => {
    const result = scoreCandidate(
      EPISODE_QUERY,
      episodeItem({ externalIds: { imdb: "tt0944947" } }),
    );

    assert.equal(result?.method, "IMDB_ID");
    assert.equal(result?.score, 98);
  });

  it("compares the SERIES title for metadata matches", () => {
    const result = scoreCandidate(EPISODE_QUERY, episodeItem());

    assert.equal(result?.method, "METADATA");
    assert.equal(result?.score, 80);
  });

  it("does not match an episode title against the series title", () => {
    assert.equal(scoreCandidate(EPISODE_QUERY, episodeItem({ seriesTitle: "The Kingsroad" })), null);
  });

  it("discards an episode that declares another series", () => {
    assert.equal(scoreCandidate(EPISODE_QUERY, episodeItem({ externalIds: { tmdb: 1 } })), null);
  });
});
