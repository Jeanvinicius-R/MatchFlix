import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createPlaybackResolver } from "./playback.resolver";
import type { PlaybackProvider, PlaybackSource, PlaybackType } from "./playback.types";
import {
  describeProxiedMediaProblem,
  describeSourceProblem,
  sanitizeSource,
} from "./source-guard";

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

describe("sanitizeSource: media proxy path", () => {
  const token = "A".repeat(64);
  const proxyUrl = `/api/playback/proxy/${token}`;

  it("accepts the proxy path as the main URL of direct and hls sources", () => {
    for (const type of ["direct", "hls"] as PlaybackType[]) {
      const input = source({ type, url: proxyUrl });
      assert.deepEqual(sanitizeSource(input), input, type);
      assert.equal(describeSourceProblem(input), null, type);
    }
  });

  it("accepts url-safe base64 characters in the token", () => {
    const input = source({ url: "/api/playback/proxy/abc_DEF-123456789012" });
    assert.notEqual(sanitizeSource(input), null);
  });

  it("refuses the proxy path for iframe, external and dash sources", () => {
    for (const type of ["iframe", "external", "dash"] as PlaybackType[]) {
      assert.equal(sanitizeSource(source({ type, url: proxyUrl })), null, type);
    }
  });

  const badProxyPaths = [
    "/api/playback/proxy/",
    "/api/playback/proxy/short",
    `/api/playback/proxy/${"A".repeat(4097)}`,
    `/api/playback/proxy/${token}/extra`,
    `/api/playback/proxy/${token}?x=1`,
    `/api/playback/proxy/${token}#x`,
    `/api/playback/proxy/${token}.mp4`,
    `/api/playback/proxy/${"A".repeat(20)}%2e%2e`,
    `/api/playback/proxy/../${token}`,
    `//api/playback/proxy/${token}`,
    `/api/playback/other/${token}`,
    `/api/playback/proxyx/${token}`,
    `/API/playback/proxy/${token}`,
    ` /api/playback/proxy/${token}`,
    `/api/playback/proxy/${token}\n`,
    "/api/library/video.mp4",
  ];

  for (const url of badProxyPaths) {
    it(`still refuses the relative path ${JSON.stringify(url.slice(0, 60))}`, () => {
      assert.equal(sanitizeSource(source({ url })), null);
    });
  }

  it("does not accept the proxy path in qualities or subtitles", () => {
    const result = sanitizeSource(
      source({
        url: proxyUrl,
        qualities: [{ label: "720p", url: proxyUrl }],
        subtitles: [{ language: "pt", label: "pt", url: proxyUrl }],
      }),
    );

    assert.notEqual(result, null);
    assert.equal("qualities" in (result ?? {}), false);
    assert.equal("subtitles" in (result ?? {}), false);
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

describe("describeProxiedMediaProblem", () => {
  const ORIGIN = "https://media.example.org";
  const media = { upstreamUrl: `${ORIGIN}/movie/u/secret/1.mp4`, allowedOrigins: [ORIGIN] };

  it("accepts direct/hls on an allowed origin, credentials in the URL included", () => {
    assert.equal(describeProxiedMediaProblem("direct", media), null);
    assert.equal(describeProxiedMediaProblem("hls", media), null);
    assert.equal(
      describeProxiedMediaProblem("direct", {
        upstreamUrl: "http://10.0.0.5:8080/movie/u/p/1.mp4",
        allowedOrigins: ["http://10.0.0.5:8080"],
      }),
      null,
    );
  });

  it("compares origins after normalisation (default port, host case)", () => {
    assert.equal(
      describeProxiedMediaProblem("direct", {
        upstreamUrl: "https://MEDIA.example.org:443/a.mp4",
        allowedOrigins: ["https://media.example.org"],
      }),
      null,
    );
  });

  it("refuses types the proxy cannot serve", () => {
    for (const type of ["dash", "iframe", "external"] as const) {
      assert.notEqual(describeProxiedMediaProblem(type, media), null, type);
    }
  });

  it("refuses an upstream outside the allowed origins, with no origins, or not http(s)", () => {
    assert.notEqual(
      describeProxiedMediaProblem("direct", { ...media, allowedOrigins: ["https://x.example.org"] }),
      null,
    );
    assert.notEqual(describeProxiedMediaProblem("direct", { ...media, allowedOrigins: [] }), null);

    for (const upstreamUrl of ["file:///etc/passwd", "ftp://media.example.org/a", "nope", ""]) {
      assert.notEqual(
        describeProxiedMediaProblem("direct", { upstreamUrl, allowedOrigins: [ORIGIN] }),
        null,
        upstreamUrl,
      );
    }
  });

  it("a different port is a different origin", () => {
    assert.notEqual(
      describeProxiedMediaProblem("direct", {
        upstreamUrl: "https://media.example.org:8443/a.mp4",
        allowedOrigins: [ORIGIN],
      }),
      null,
    );
  });

  it("never echoes the upstream URL (it may hold credentials)", () => {
    const problems = [
      describeProxiedMediaProblem("dash", media),
      describeProxiedMediaProblem("direct", { ...media, allowedOrigins: ["https://x.example.org"] }),
      describeProxiedMediaProblem("direct", { upstreamUrl: "ftp://u:secret@h/a", allowedOrigins: [ORIGIN] }),
    ];

    for (const problem of problems) {
      assert.ok(problem && !problem.includes("secret"));
    }
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
