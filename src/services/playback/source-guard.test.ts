import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createPlaybackResolver } from "./playback.resolver";
import type { PlaybackProvider, PlaybackSource, PlaybackType } from "./playback.types";
import { describeSourceProblem, sanitizeSource } from "./source-guard";

function source(overrides: Partial<PlaybackSource> = {}): PlaybackSource {
  return {
    id: "s",
    provider: "p",
    type: "direct",
    url: "https://cdn.example.org/film.mp4",
    ...overrides,
  };
}

describe("sanitizeSource: main URL", () => {
  it("accepts https for every type", () => {
    for (const type of ["iframe", "hls", "dash", "direct", "external"] as PlaybackType[]) {
      const input = source({ type });
      assert.deepEqual(sanitizeSource(input), input, type);
    }
  });

  it("accepts http only for iframe and external", () => {
    const url = "http://videos.example.org/movie/1";
    assert.notEqual(sanitizeSource(source({ type: "iframe", url })), null);
    assert.notEqual(sanitizeSource(source({ type: "external", url })), null);

    for (const type of ["direct", "hls", "dash"] as PlaybackType[]) {
      assert.equal(sanitizeSource(source({ type, url })), null, type);
    }
  });

  const unsafeUrls = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:video/mp4;base64,AAAA",
    "blob:https://example.org/abc",
    "file:///etc/passwd",
    "ftp://example.org/film.mp4",
    "//cdn.example.org/film.mp4",
    "/relative/film.mp4",
    "https://user:secret@cdn.example.org/film.mp4",
    "https://user@cdn.example.org/film.mp4",
    "https://:secret@cdn.example.org/film.mp4",
    "https://",
    "not a url",
    "",
  ];

  for (const url of unsafeUrls) {
    it(`drops iframe sources with url "${url}"`, () => {
      assert.equal(sanitizeSource(source({ type: "iframe", url })), null);
      assert.notEqual(describeSourceProblem(source({ type: "iframe", url })), null);
    });
  }

  it("drops absurdly long URLs", () => {
    const url = `https://cdn.example.org/${"a".repeat(5000)}`;
    assert.equal(sanitizeSource(source({ url })), null);
  });

  it("drops unknown source types", () => {
    const input = source({ type: "flash" as unknown as PlaybackType });
    assert.equal(sanitizeSource(input), null);
  });

  it("drops a source whose url is not a string", () => {
    const input = source({ url: undefined as unknown as string });
    assert.equal(sanitizeSource(input), null);
  });

  it("describes nothing for a safe source", () => {
    assert.equal(describeSourceProblem(source()), null);
  });
});

describe("sanitizeSource: extras", () => {
  it("keeps clean qualities and subtitles untouched", () => {
    const input = source({
      qualities: [{ label: "720p", height: 720, url: "https://cdn.example.org/720.mp4" }],
      subtitles: [{ language: "pt", label: "Português", url: "https://cdn.example.org/pt.vtt" }],
      attribution: { license: "CC BY", author: "A", sourceUrl: "https://example.org/w/1" },
    });
    assert.deepEqual(sanitizeSource(input), input);
  });

  it("strips bad qualities and subtitles instead of the whole source", () => {
    const result = sanitizeSource(
      source({
        qualities: [
          { label: "1080p", url: "http://cdn.example.org/1080.mp4" },
          { label: "720p", url: "https://cdn.example.org/720.mp4" },
          { label: "evil", url: "javascript:alert(1)" },
        ],
        subtitles: [
          { language: "pt", label: "pt", url: "https://u:p@cdn.example.org/pt.vtt" },
          { language: "en", label: "en", url: "https://cdn.example.org/en.vtt" },
        ],
      }),
    );

    assert.deepEqual(result?.qualities, [
      { label: "720p", url: "https://cdn.example.org/720.mp4" },
    ]);
    assert.deepEqual(result?.subtitles, [
      { language: "en", label: "en", url: "https://cdn.example.org/en.vtt" },
    ]);
  });

  it("removes the lists when nothing valid is left", () => {
    const result = sanitizeSource(
      source({
        qualities: [{ label: "x", url: "data:video/mp4;base64,AA" }],
        subtitles: [{ language: "pt", label: "pt", url: "http://cdn.example.org/pt.vtt" }],
      }),
    );

    assert.notEqual(result, null);
    assert.equal("qualities" in (result ?? {}), false);
    assert.equal("subtitles" in (result ?? {}), false);
  });

  it("drops an attribution link that is not http(s), keeping the credit", () => {
    const result = sanitizeSource(
      source({
        attribution: { license: "CC BY", author: "A", sourceUrl: "javascript:alert(1)" },
      }),
    );

    assert.deepEqual(result?.attribution, { license: "CC BY", author: "A" });
  });

  it("does not mutate its input", () => {
    const input = source({
      qualities: [{ label: "x", url: "http://cdn.example.org/x.mp4" }],
      attribution: { sourceUrl: "javascript:alert(1)" },
    });
    sanitizeSource(input);

    assert.equal(input.qualities?.length, 1);
    assert.equal(input.attribution?.sourceUrl, "javascript:alert(1)");
  });
});

describe("PlaybackResolver with the source guard", () => {
  function provider(id: string, result: PlaybackSource): PlaybackProvider {
    return {
      id,
      label: id,
      getMovieSource: async () => result,
      getEpisodeSource: async () => result,
    };
  }

  it("drops unsafe sources with a warning and keeps the rest", async () => {
    const warn = mock.method(console, "warn", () => {});
    const good = source({ id: "good", provider: "good" });
    const resolver = createPlaybackResolver([
      provider("evil", source({ id: "evil", type: "iframe", url: "javascript:alert(1)" })),
      provider("insecure", source({ id: "insecure", url: "http://cdn.example.org/a.mp4" })),
      provider("leaky", source({ id: "leaky", url: "https://u:p@cdn.example.org/a.mp4" })),
      provider("good", good),
    ]);

    assert.deepEqual(await resolver.resolveMovie({ tmdbId: 1 }), [good]);
    assert.deepEqual(await resolver.resolveEpisode({ tmdbId: 1, season: 1, episode: 1 }), [
      good,
    ]);
    assert.equal(warn.mock.callCount(), 6);
    warn.mock.restore();
  });
});
