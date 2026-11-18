import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { AdapterFailure, PlaybackAdapter, ResolvedAsset } from "../adapters/adapter.types";
import {
  createAssociationProvider,
  type AssociationCandidate,
  type AssociationCandidateQuery,
} from "./association.provider";

const ASSET: ResolvedAsset = {
  type: "direct",
  url: "https://cdn.example.org/film.mp4",
  mimeType: "video/mp4",
  label: "Fake CDN",
  attribution: { license: "CC BY 3.0", sourceUrl: "https://example.org/details/film" },
};

function candidate(overrides: Partial<AssociationCandidate> = {}): AssociationCandidate {
  return {
    id: "assoc-1",
    providerAssetId: "film-1",
    rightsStatus: "VERIFIED",
    availabilityStatus: "UNKNOWN",
    ...overrides,
  };
}

function fakeRepository(
  result: AssociationCandidate[] | (() => Promise<AssociationCandidate[]>),
) {
  const queries: AssociationCandidateQuery[] = [];

  return {
    queries,
    async findPlayableCandidates(query: AssociationCandidateQuery) {
      queries.push(query);
      return typeof result === "function" ? result() : result;
    },
  };
}

function fakeAdapter(
  resolve: (assetId: string, signal: AbortSignal) => Promise<ResolvedAsset | AdapterFailure>,
) {
  const calls: { assetId: string; signal: AbortSignal }[] = [];
  const adapter: PlaybackAdapter = {
    id: "fake",
    label: "Fake",
    assetIdHint: "",
    async resolve(assetId, { signal }) {
      calls.push({ assetId, signal });
      return resolve(assetId, signal);
    },
  };

  return { adapter, calls };
}

let warn: ReturnType<typeof mock.method>;

beforeEach(() => {
  warn = mock.method(console, "warn", () => {});
});

afterEach(() => {
  warn.mock.restore();
});

describe("createAssociationProvider", () => {
  it("uses the adapter's id and label", () => {
    const { adapter } = fakeAdapter(async () => ASSET);
    const provider = createAssociationProvider({ adapter, repository: fakeRepository([]) });

    assert.equal(provider.id, "fake");
    assert.equal(provider.label, "Fake");
  });

  it("returns a source for a VERIFIED association", async () => {
    const { adapter, calls } = fakeAdapter(async () => ASSET);
    const repository = fakeRepository([candidate()]);
    const provider = createAssociationProvider({ adapter, repository });

    assert.deepEqual(await provider.getMovieSource({ tmdbId: 10378 }), {
      id: "fake-assoc-1",
      provider: "fake",
      type: "direct",
      url: "https://cdn.example.org/film.mp4",
      label: "Fake CDN",
      mimeType: "video/mp4",
      attribution: ASSET.attribution,
    });
    assert.deepEqual(repository.queries, [
      { tmdbId: 10378, mediaType: "MOVIE", seasonNumber: 0, episodeNumber: 0, provider: "fake" },
    ]);
    assert.equal(calls[0].assetId, "film-1");
    assert.ok(calls[0].signal instanceof AbortSignal);
  });

  it("passes qualities and subtitles through and defaults the label to the adapter's", async () => {
    const { adapter } = fakeAdapter(async () => ({
      type: "hls",
      url: "https://cdn.example.org/master.m3u8",
      qualities: [{ label: "720p", url: "https://cdn.example.org/720.mp4" }],
      subtitles: [{ language: "pt", label: "Português", url: "https://cdn.example.org/pt.vtt" }],
    }));
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([candidate()]),
    });
    const source = await provider.getMovieSource({ tmdbId: 1 });

    assert.equal(source?.label, "Fake");
    assert.equal(source?.qualities?.length, 1);
    assert.equal(source?.subtitles?.[0].language, "pt");
  });

  it("queries episodes by series id, season and episode", async () => {
    const { adapter } = fakeAdapter(async () => ASSET);
    const repository = fakeRepository([candidate()]);
    const provider = createAssociationProvider({ adapter, repository });

    assert.notEqual(
      await provider.getEpisodeSource({ tmdbId: 1399, season: 0, episode: 3 }),
      null,
    );
    assert.deepEqual(repository.queries, [
      { tmdbId: 1399, mediaType: "EPISODE", seasonNumber: 0, episodeNumber: 3, provider: "fake" },
    ]);
  });

  it("makes no query for episodes without a valid season/episode, or invalid ids", async () => {
    const { adapter, calls } = fakeAdapter(async () => ASSET);
    const repository = fakeRepository([candidate()]);
    const provider = createAssociationProvider({ adapter, repository });

    assert.equal(await provider.getEpisodeSource({ tmdbId: 1 }), null);
    assert.equal(await provider.getEpisodeSource({ tmdbId: 1, season: 1 }), null);
    assert.equal(await provider.getEpisodeSource({ tmdbId: 1, season: 1, episode: 0 }), null);
    assert.equal(await provider.getEpisodeSource({ tmdbId: 1, season: -1, episode: 1 }), null);
    assert.equal(await provider.getEpisodeSource({ tmdbId: 0, season: 1, episode: 1 }), null);
    assert.equal(await provider.getEpisodeSource({ tmdbId: 1, season: 1.5, episode: 1 }), null);
    assert.equal(await provider.getMovieSource({ tmdbId: 0 }), null);
    assert.equal(await provider.getMovieSource({ tmdbId: Number.NaN }), null);
    assert.equal(repository.queries.length, 0);
    assert.equal(calls.length, 0);
  });

  it("returns null without touching the adapter when there is no association", async () => {
    const { adapter, calls } = fakeAdapter(async () => ASSET);
    const provider = createAssociationProvider({ adapter, repository: fakeRepository([]) });

    assert.equal(await provider.getMovieSource({ tmdbId: 5 }), null);
    assert.equal(calls.length, 0);
  });
});

describe("createAssociationProvider: fail-closed on rights", () => {
  for (const rightsStatus of ["UNVERIFIED", "EXPIRED", "REVOKED", "verified", "", "ANYTHING"]) {
    it(`never touches the adapter for rights "${rightsStatus}"`, async () => {
      const { adapter, calls } = fakeAdapter(async () => ASSET);
      // A misbehaving repository returns it anyway: the provider must still refuse.
      const provider = createAssociationProvider({
        adapter,
        repository: fakeRepository([candidate({ rightsStatus })]),
      });

      assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
      assert.equal(calls.length, 0);
    });
  }

  it("skips associations whose last check found them UNAVAILABLE", async () => {
    const { adapter, calls } = fakeAdapter(async () => ASSET);
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([candidate({ availabilityStatus: "UNAVAILABLE" })]),
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
    assert.equal(calls.length, 0);
  });

  it("plays AVAILABLE and UNKNOWN associations, and ignores the unverified one in a mix", async () => {
    const { adapter, calls } = fakeAdapter(async () => ASSET);
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([
        candidate({ id: "a", providerAssetId: "revoked", rightsStatus: "REVOKED" }),
        candidate({ id: "b", providerAssetId: "ok", availabilityStatus: "AVAILABLE" }),
      ]),
    });
    const source = await provider.getMovieSource({ tmdbId: 1 });

    assert.equal(source?.id, "fake-b");
    assert.deepEqual(
      calls.map((call) => call.assetId),
      ["ok"],
    );
  });
});

describe("createAssociationProvider: remote failures never throw", () => {
  it("returns null when the adapter throws", async () => {
    const { adapter } = fakeAdapter(async () => {
      throw new Error("boom");
    });
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([candidate()]),
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
    assert.equal(warn.mock.callCount(), 1);
  });

  it("returns null when the adapter refuses", async () => {
    const { adapter } = fakeAdapter(async () => ({ reason: "sem licença" }));
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([candidate()]),
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
  });

  it("returns null when the repository throws", async () => {
    const { adapter, calls } = fakeAdapter(async () => ASSET);
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository(async () => {
        throw new Error("db down");
      }),
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
    assert.equal(calls.length, 0);
  });

  it("aborts a slow adapter through the signal", async () => {
    const { adapter } = fakeAdapter(
      (_assetId, signal) =>
        new Promise((_resolve, reject) => {
          // AbortSignal.timeout() timers are unref'd: keep the loop alive until it fires.
          const keepAlive = setTimeout(() => {}, 1_000);
          signal.addEventListener("abort", () => {
            clearTimeout(keepAlive);
            reject(new Error("aborted"));
          });
        }),
    );
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([candidate()]),
      timeoutMs: 10,
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
  });

  it("falls through to the next candidate and returns the first valid source", async () => {
    const { adapter, calls } = fakeAdapter(async (assetId) => {
      if (assetId === "dead") {
        return { reason: "gone" };
      }
      if (assetId === "boom") {
        throw new Error("boom");
      }
      return { ...ASSET, url: `https://cdn.example.org/${assetId}.mp4` };
    });
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([
        candidate({ id: "1", providerAssetId: "dead" }),
        candidate({ id: "2", providerAssetId: "boom" }),
        candidate({ id: "3", providerAssetId: "alive" }),
        candidate({ id: "4", providerAssetId: "later" }),
      ]),
    });
    const source = await provider.getMovieSource({ tmdbId: 1 });

    assert.equal(source?.url, "https://cdn.example.org/alive.mp4");
    assert.equal(source?.id, "fake-3");
    assert.equal(calls.length, 3);
  });

  it("never fans out to more than three remote calls", async () => {
    const { adapter, calls } = fakeAdapter(async () => ({ reason: "no" }));
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository(
        ["1", "2", "3", "4", "5"].map((id) => candidate({ id, providerAssetId: id })),
      ),
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
    assert.equal(calls.length, 3);
  });

  it("discards an adapter result with an unsafe URL and tries the next", async () => {
    const { adapter } = fakeAdapter(async (assetId) =>
      assetId === "bad"
        ? { type: "direct", url: "http://cdn.example.org/film.mp4" }
        : { type: "direct", url: "https://cdn.example.org/film.mp4" },
    );
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([
        candidate({ id: "1", providerAssetId: "bad" }),
        candidate({ id: "2", providerAssetId: "good" }),
      ]),
    });

    assert.equal((await provider.getMovieSource({ tmdbId: 1 }))?.id, "fake-2");
  });

  it("returns null when the only result has a script URL", async () => {
    const { adapter } = fakeAdapter(async () => ({
      type: "iframe",
      url: "javascript:alert(1)",
    }));
    const provider = createAssociationProvider({
      adapter,
      repository: fakeRepository([candidate()]),
    });

    assert.equal(await provider.getMovieSource({ tmdbId: 1 }), null);
  });
});
