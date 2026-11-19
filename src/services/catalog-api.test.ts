import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_PAGE_SIZE,
  buildPageView,
  isTmdbNotFound,
  parsePage,
  parseSearchTerm,
  parseSeasonNumber,
  parseTmdbId,
} from "./catalog-api";

describe("parsePage", () => {
  it("defaults to the first page", () => {
    assert.equal(parsePage(null), 1);
  });

  it("accepts positive whole numbers", () => {
    assert.equal(parsePage("1"), 1);
    assert.equal(parsePage(" 7 "), 7);
    assert.equal(parsePage("100000"), 100_000);
  });

  it("rejects everything else", () => {
    for (const raw of ["", "0", "-1", "1.5", "abc", "1e3", "100001", "9999999", "+2"]) {
      assert.equal(parsePage(raw), null, raw);
    }
  });
});

describe("parseTmdbId / parseSeasonNumber", () => {
  it("parses ids", () => {
    assert.equal(parseTmdbId("10378"), 10378);
    for (const raw of ["0", "-5", "1.5", "x", "", "1234567890"]) {
      assert.equal(parseTmdbId(raw), null, raw);
    }
  });

  it("allows season 0 (specials) but not negatives", () => {
    assert.equal(parseSeasonNumber("0"), 0);
    assert.equal(parseSeasonNumber("12"), 12);
    for (const raw of ["-1", "1.5", "x", "", "12345"]) {
      assert.equal(parseSeasonNumber(raw), null, raw);
    }
  });
});

describe("parseSearchTerm", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(parseSearchTerm("  big   buck  bunny "), "big buck bunny");
  });

  it("rejects missing, one-character and oversized terms", () => {
    assert.equal(parseSearchTerm(null), null);
    assert.equal(parseSearchTerm(""), null);
    assert.equal(parseSearchTerm(" a "), null);
    assert.equal(parseSearchTerm("x".repeat(101)), null);
    assert.equal(parseSearchTerm("x".repeat(100)), "x".repeat(100));
  });
});

describe("buildPageView", () => {
  it("computes the page count", () => {
    const view = buildPageView(["a"], 49, 2);
    assert.equal(view.pageSize, CATALOG_PAGE_SIZE);
    assert.equal(view.totalPages, 3);
    assert.equal(view.page, 2);
    assert.equal(view.total, 49);
  });

  it("has one (empty) page for an empty catalog", () => {
    assert.equal(buildPageView([], 0, 1).totalPages, 1);
  });

  it("keeps a page past the end empty instead of failing", () => {
    const view = buildPageView([], 10, 9);
    assert.equal(view.totalPages, 1);
    assert.deepEqual(view.items, []);
  });
});

describe("isTmdbNotFound", () => {
  it("recognizes the 404 raised by the TMDB client", () => {
    assert.equal(
      isTmdbNotFound(new Error("Falha ao consultar a TMDB (HTTP 404) em /movie/1")),
      true,
    );
  });

  it("is false for other failures", () => {
    assert.equal(
      isTmdbNotFound(new Error("Falha ao consultar a TMDB (HTTP 500) em /movie/1")),
      false,
    );
    assert.equal(isTmdbNotFound(new Error("TMDB_ACCESS_TOKEN não está definida.")), false);
    assert.equal(isTmdbNotFound("HTTP 404"), false);
    assert.equal(isTmdbNotFound(null), false);
  });
});
