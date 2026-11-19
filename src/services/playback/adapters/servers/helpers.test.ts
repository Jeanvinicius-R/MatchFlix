import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLoadingCache } from "./cache";
import { isValidJsonPath, readPath, readPathId, readPathNumber, readPathString } from "./json-path";
import { DEFAULT_M3U_LIMITS, hashEntryUrl, parseM3u } from "./m3u-parser";
import {
  normalizeTitle,
  parseEpisodeName,
  parseImdbId,
  parseTmdbId,
  parseYear,
  splitTitleYear,
  titlesMatch,
  yearsClose,
} from "./match-utils";
import {
  allowedOriginsFor,
  extensionOfUrl,
  isOnAllowedOrigin,
  mediaFromExtension,
  originOf,
  toProxiedMedia,
} from "./shared";

describe("json-path", () => {
  const doc = {
    playback: { url: "  https://x.example.com/v.mp4 ", type: "" },
    ids: { tmdb: 603, text: "42", imdb: "tt0133093" },
    results: [{ id: 7 }, { id: "b" }],
  };

  it("validates paths", () => {
    assert.equal(isValidJsonPath("a.b.0.c"), true);
    assert.equal(isValidJsonPath(""), false);
    assert.equal(isValidJsonPath("a b"), false);
    assert.equal(isValidJsonPath("a..b"), false);
    assert.equal(isValidJsonPath("a.__proto__"), false);
    assert.equal(isValidJsonPath("constructor.prototype"), false);
    assert.equal(isValidJsonPath("a.b.c.d.e.f.g.h.i"), false);
  });

  it("reads nested values and array indexes", () => {
    assert.equal(readPath(doc, "ids.tmdb"), 603);
    assert.equal(readPath(doc, "results.1.id"), "b");
    assert.equal(readPath(doc, "results.5.id"), undefined);
    assert.equal(readPath(doc, "results.length"), undefined);
    assert.equal(readPath(doc, "missing.deep.path"), undefined);
    assert.equal(readPath(null, "a"), undefined);
  });

  it("never reaches inherited properties", () => {
    assert.equal(readPath({}, "toString"), undefined);
    assert.equal(readPath({}, "__proto__"), undefined);
    assert.equal(readPath({ a: 1 }, "a.toString"), undefined);
  });

  it("converts by type", () => {
    assert.equal(readPathString(doc, "playback.url"), "https://x.example.com/v.mp4");
    assert.equal(readPathString(doc, "playback.type"), undefined);
    assert.equal(readPathString(doc, "ids.tmdb"), undefined);
    assert.equal(readPathId(doc, "results.0.id"), "7");
    assert.equal(readPathId(doc, "results.1.id"), "b");
    assert.equal(readPathNumber(doc, "ids.text"), 42);
    assert.equal(readPathNumber(doc, "ids.imdb"), undefined);
  });
});

describe("m3u-parser", () => {
  const A = "https://a.example.com";

  it("parses attributes, names and groups", () => {
    const entries = parseM3u(
      [
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="id1" tvg-name="Tvg Name" group-title="Filmes, Ação",Nome, Com Virgula',
        `${A}/1.mp4`,
        '#EXTINF:-1 tvg-name="Só Tvg",',
        `${A}/2.mp4`,
        "#EXTGRP:Series",
        "#EXTINF:-1,Sem Grupo",
        `${A}/3.m3u8`,
        `${A}/4.mp4`,
        "#EXTINF:-1,Duplicado",
        `${A}/1.mp4`,
        "#EXTINF:-1,Nao eh url",
        "not a url",
        "",
      ].join("\n"),
    );

    assert.deepEqual(
      entries.map((entry) => entry.url),
      [`${A}/1.mp4`, `${A}/2.mp4`, `${A}/3.m3u8`],
    );
    assert.equal(entries[0].name, "Nome, Com Virgula");
    assert.equal(entries[0].tvgId, "id1");
    assert.equal(entries[0].tvgName, "Tvg Name");
    assert.equal(entries[0].groupTitle, "Filmes, Ação");
    assert.equal(entries[1].name, "Só Tvg");
    assert.equal(entries[2].groupTitle, "Series");
    assert.equal(entries[0].id, hashEntryUrl(`${A}/1.mp4`));
    assert.match(entries[0].id, /^m3u:[0-9a-f]{12}$/);
  });

  it("returns nothing for text that is not a playlist", () => {
    assert.deepEqual(parseM3u("<html>erro</html>"), []);
    assert.deepEqual(parseM3u(""), []);
    assert.deepEqual(parseM3u("#EXTM3U"), []);
  });

  it("accepts a BOM and CRLF line endings", () => {
    const entries = parseM3u(`﻿#EXTM3U\r\n#EXTINF:-1,A\r\n${A}/a.mp4\r\n`);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "A");
  });

  it("bounds entries and line length", () => {
    const text = `#EXTM3U\n#EXTINF:-1,A\n${A}/a.mp4\n#EXTINF:-1,B\n${A}/b.mp4\n`;

    assert.equal(parseM3u(text, { maxEntries: 1 }).length, 1);

    const long = `#EXTM3U\n#EXTINF:-1,Long\n${A}/${"x".repeat(60)}.mp4\n#EXTINF:-1,Short\n${A}/s.mp4\n`;
    const entries = parseM3u(long, { maxLineLength: 40 });

    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["Short"],
    );
    assert.ok(DEFAULT_M3U_LIMITS.maxLines > 0);
  });

  it("only accepts http(s) URLs", () => {
    const entries = parseM3u(`#EXTM3U\n#EXTINF:-1,F\nfile:///etc/passwd\n#EXTINF:-1,G\njavascript:alert(1)\n`);

    assert.deepEqual(entries, []);
  });
});

describe("match-utils", () => {
  it("normalizes titles", () => {
    assert.equal(normalizeTitle("O Cavaleiro das Trevas: A Ascensão"), "o cavaleiro das trevas a ascensao");
    assert.equal(normalizeTitle("Tom & Jerry"), "tom and jerry");
    assert.equal(normalizeTitle("***"), "");
  });

  it("splits tags and years off provider titles", () => {
    assert.deepEqual(splitTitleYear("Matrix (1999)"), { title: "Matrix", year: 1999 });
    assert.deepEqual(splitTitleYear("[PT-BR] Matrix (1999) [4K]"), { title: "Matrix", year: 1999 });
    assert.deepEqual(splitTitleYear("The Matrix [4K]"), { title: "The Matrix" });
    assert.deepEqual(splitTitleYear("2001: Uma Odisseia"), { title: "2001: Uma Odisseia" });
  });

  it("bounds hostile provider titles before the backtracking regexes", () => {
    const started = Date.now();
    const result = splitTitleYear("(".repeat(200_000));

    assert.ok(result.title.length <= 300);
    assert.ok(Date.now() - started < 2_000);
  });

  it("matches titles and years leniently but not blindly", () => {
    assert.equal(titlesMatch(["Matrix", undefined], "MATRIX"), true);
    assert.equal(titlesMatch([undefined, "The Matrix"], "the matrix"), true);
    assert.equal(titlesMatch(["Matrix"], "Matrix Reloaded"), false);
    assert.equal(titlesMatch(["Matrix"], "***"), false);
    assert.equal(yearsClose(1999, 2000), true);
    assert.equal(yearsClose(1999, 2002), false);
    assert.equal(yearsClose(undefined, 2002), true);
  });

  it("parses identifiers", () => {
    assert.equal(parseTmdbId(603), 603);
    assert.equal(parseTmdbId("603"), 603);
    assert.equal(parseTmdbId("0"), undefined);
    assert.equal(parseTmdbId("abc"), undefined);
    assert.equal(parseTmdbId(-4), undefined);
    assert.equal(parseImdbId("tt0133093"), "tt0133093");
    assert.equal(parseImdbId("0133093"), undefined);
    assert.equal(parseYear("1999-03-31"), 1999);
    assert.equal(parseYear(1999), 1999);
    assert.equal(parseYear("1500"), undefined);
    assert.equal(parseYear(null), undefined);
  });

  it("recognizes episode names", () => {
    assert.deepEqual(parseEpisodeName("Breaking Bad S01E03"), {
      seriesTitle: "Breaking Bad",
      season: 1,
      episode: 3,
    });
    assert.deepEqual(parseEpisodeName("Breaking Bad 1x03"), {
      seriesTitle: "Breaking Bad",
      season: 1,
      episode: 3,
    });
    assert.equal(parseEpisodeName("S01E03"), null);
    assert.equal(parseEpisodeName("Matrix (1999)"), null);
  });
});

describe("loading cache", () => {
  it("runs the loader once for concurrent callers and keeps the value until the TTL", async () => {
    let clock = 0;
    let runs = 0;
    const cache = createLoadingCache<{ n: number }>({ ttlMs: 1000, now: () => clock });
    const loader = async () => {
      runs += 1;
      return { n: runs };
    };

    const [a, b] = await Promise.all([cache.load(loader), cache.load(loader)]);

    assert.deepEqual(a, { n: 1 });
    assert.equal(a, b);
    assert.equal(runs, 1);

    clock = 999;
    assert.deepEqual(await cache.load(loader), { n: 1 });
    clock = 1000;
    assert.deepEqual(await cache.load(loader), { n: 2 });

    cache.clear();
    assert.deepEqual(await cache.load(loader), { n: 3 });
  });

  it("never caches a failure", async () => {
    const cache = createLoadingCache<{ ok: true }>({ ttlMs: 1000, now: () => 0 });
    let healthy = false;
    const loader = async () => (healthy ? { ok: true as const } : { reason: "fora do ar" });

    assert.deepEqual(await cache.load(loader), { reason: "fora do ar" });
    healthy = true;
    assert.deepEqual(await cache.load(loader), { ok: true });
  });
});

describe("shared helpers", () => {
  it("derives extensions, origins and media kinds", () => {
    assert.equal(extensionOfUrl("https://x.example.com/a/b.MP4?t=1"), "mp4");
    assert.equal(extensionOfUrl("https://x.example.com/a/b"), "");
    assert.equal(extensionOfUrl("nope"), "");
    assert.equal(originOf("https://x.example.com:8443/a"), "https://x.example.com:8443");
    assert.equal(originOf("ftp://x.example.com/a"), null);
    assert.equal(mediaFromExtension("M3U8")?.type, "hls");
    assert.equal(mediaFromExtension("mkv"), null);
  });

  it("builds the allowed origin list without repeats", () => {
    assert.deepEqual(
      allowedOriginsFor("https://a.example.com/x", [
        "https://b.example.com",
        "https://a.example.com",
        "ftp://c.example.com",
      ]),
      ["https://a.example.com", "https://b.example.com"],
    );
    assert.equal(isOnAllowedOrigin("https://a.example.com/v.mp4", ["https://a.example.com"]), true);
    assert.equal(isOnAllowedOrigin("http://a.example.com/v.mp4", ["https://a.example.com"]), false);
  });

  it("refuses to proxy what the proxy cannot carry safely", () => {
    const origins = ["https://a.example.com"];
    const hls = { type: "hls" as const, mimeType: "application/vnd.apple.mpegurl" };
    const dash = { type: "dash" as const, mimeType: "application/dash+xml" };
    const mp4 = { type: "direct" as const, mimeType: "video/mp4" };
    const none = { type: "none" as const };

    assert.ok("reason" in toProxiedMedia({ url: "https://a.example.com/v.mpd", auth: none, media: dash, allowedOrigins: origins }));
    assert.ok(
      "reason" in
        toProxiedMedia({
          url: "https://a.example.com/v.m3u8",
          auth: { type: "query", name: "k", value: "v" },
          media: hls,
          allowedOrigins: origins,
        }),
    );
    assert.ok("reason" in toProxiedMedia({ url: "https://evil.example.org/v.mp4", auth: none, media: mp4, allowedOrigins: origins }));
    assert.ok("reason" in toProxiedMedia({ url: "https://u:p@a.example.com/v.mp4", auth: none, media: mp4, allowedOrigins: origins }));
    assert.ok(!("reason" in toProxiedMedia({ url: "https://a.example.com/v.mp4", auth: none, media: mp4, allowedOrigins: origins })));
  });
});
