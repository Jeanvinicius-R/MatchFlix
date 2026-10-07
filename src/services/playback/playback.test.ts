import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { hasKnownPlaybackSource } from "./availability";
import { createPlaybackResolver } from "./playback.resolver";
import type { PlaybackProvider, PlaybackSource } from "./playback.types";
import { authorizedProvider } from "./providers/authorized.provider";
import { CURATED_MOVIES, internetArchiveProvider } from "./providers/internet-archive.provider";

function provider(
  id: string,
  getMovieSource: PlaybackProvider["getMovieSource"],
): PlaybackProvider {
  return { id, label: id, getMovieSource, getEpisodeSource: async () => null };
}

const SOURCE: PlaybackSource = { id: "ok", provider: "ok", type: "iframe", url: "https://example.org/x" };

describe("PlaybackResolver", () => {
  it("keeps the sources of providers that succeed when others fail", async () => {
    const error = mock.method(console, "error", () => {});
    const resolver = createPlaybackResolver([
      provider("throws", async () => {
        throw new Error("boom");
      }),
      provider("empty", async () => null),
      provider("ok", async () => SOURCE),
    ]);
    assert.deepEqual(await resolver.resolveMovie({ tmdbId: 1 }), [SOURCE]);
    assert.equal(error.mock.callCount(), 1);
    error.mock.restore();
  });

  it("drops a provider that exceeds the timeout", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const error = mock.method(console, "error", () => {});
    const resolver = createPlaybackResolver([
      provider("hangs", () => new Promise(() => {})),
      provider("ok", async () => SOURCE),
    ]);
    const pending = resolver.resolveMovie({ tmdbId: 1 });
    // Let the fast provider settle first (setImmediate is not mocked), then expire the slow one.
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(5_000);
    assert.deepEqual(await pending, [SOURCE]);
    error.mock.restore();
    mock.timers.reset();
  });
});

describe("authorizedProvider", () => {
  afterEach(() => {
    delete process.env.PLAYBACK_AUTHORIZED_BASE_URL;
  });

  it("is off when the base URL is unset", async () => {
    assert.equal(await authorizedProvider.getMovieSource({ tmdbId: 10 }), null);
  });

  it("refuses non-http(s) base URLs", async () => {
    process.env.PLAYBACK_AUTHORIZED_BASE_URL = "javascript:alert(1)";
    assert.equal(await authorizedProvider.getMovieSource({ tmdbId: 10 }), null);
  });

  it("builds movie and episode URLs from the base", async () => {
    process.env.PLAYBACK_AUTHORIZED_BASE_URL = "https://videos.example.org/";
    assert.equal(
      (await authorizedProvider.getMovieSource({ tmdbId: 10 }))?.url,
      "https://videos.example.org/movie/10",
    );
    assert.equal(
      (await authorizedProvider.getEpisodeSource({ tmdbId: 10, season: 2, episode: 3 }))?.url,
      "https://videos.example.org/tv/10/2/3",
    );
  });
});

describe("internetArchiveProvider", () => {
  it("embeds curated titles only", async () => {
    const source = await internetArchiveProvider.getMovieSource({ tmdbId: 3085 });
    assert.equal(source?.url, "https://archive.org/embed/his_girl_friday");
    assert.equal(await internetArchiveProvider.getMovieSource({ tmdbId: 999_999_999 }), null);
  });

  it("has no episodes", async () => {
    assert.equal(
      await internetArchiveProvider.getEpisodeSource({ tmdbId: 3085, season: 1, episode: 1 }),
      null,
    );
  });

  it("only lists films old enough to be public domain in Brazil (Lei 9.610, art. 44)", () => {
    for (const entry of CURATED_MOVIES) {
      assert.ok(entry.year < 1956, `${entry.title} (${entry.year})`);
      assert.ok(entry.license.length > 0);
    }
  });
});

describe("hasKnownPlaybackSource", () => {
  afterEach(() => {
    delete process.env.PLAYBACK_AUTHORIZED_BASE_URL;
  });

  it("knows curated Archive movies, not unknown ones", () => {
    assert.equal(hasKnownPlaybackSource(3085, "movie"), true);
    assert.equal(hasKnownPlaybackSource(3085, "series"), false);
    assert.equal(hasKnownPlaybackSource(123, "movie"), false);
    assert.equal(hasKnownPlaybackSource(null, "movie"), false);
  });

  it("counts every TMDB title when the authorized source is configured", () => {
    process.env.PLAYBACK_AUTHORIZED_BASE_URL = "https://videos.example.org";
    assert.equal(hasKnownPlaybackSource(123, "series"), true);
  });
});
