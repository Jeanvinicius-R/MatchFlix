import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdapterFailure } from "./adapter.types";
import {
  createPeerTubeAdapter,
  parsePeerTubeAssetId,
  parsePeerTubeInstances,
} from "./peertube.adapter";

const HOST = "tube.example.org";
const UUID = "f56ae219-f076-4faf-a7f2-ba8b29d1cc5f";
const ASSET_ID = `${HOST}/${UUID}`;
const HLS_URL = `https://tube.example.org/streaming-playlists/hls/${UUID}/master.m3u8`;

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    uuid: UUID,
    shortUUID: "wiGGjHcDBjwMXQqmWHG1U8",
    name: "A film",
    isLive: false,
    licence: { id: 1, label: "Attribution" },
    privacy: { id: 1, label: "Public" },
    state: { id: 1, label: "Published" },
    account: { displayName: "Alice" },
    channel: { displayName: "Alice's channel" },
    streamingPlaylists: [{ type: 1, playlistUrl: HLS_URL }],
    files: [],
    ...overrides,
  };
}

/** A JSON body, or a function producing the raw Response (or throwing). */
interface Routes {
  details?: unknown;
  captions?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(value: unknown): Response {
  return typeof value === "function" ? (value as () => Response)() : json(value);
}

function fakePeerTube(routes: Routes) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/captions")) {
      return reply(routes.captions ?? { total: 0, data: [] });
    }

    return reply(routes.details ?? video());
  }) as typeof fetch;

  return { impl, calls };
}

function signal() {
  return { signal: new AbortController().signal };
}

function adapterFor(routes: Routes, allowedInstances: string[] = [HOST]) {
  const { impl, calls } = fakePeerTube(routes);
  return { adapter: createPeerTubeAdapter({ fetchImpl: impl, allowedInstances }), calls };
}

describe("parsePeerTubeInstances", () => {
  it("keeps well-formed hosts, lowercased", () => {
    const hosts = parsePeerTubeInstances(
      " Framatube.org , https://video.blender.org/ignored/path ,, tube.example.org:8443 ",
    );
    assert.deepEqual(
      [...hosts].sort(),
      ["framatube.org", "tube.example.org:8443", "video.blender.org"].sort(),
    );
  });

  it("drops junk, localhost, IP literals and non-https URLs", () => {
    const hosts = parsePeerTubeInstances(
      [
        "localhost",
        "127.0.0.1",
        "10.0.0.5:8080",
        "http://tube.example.org",
        "javascript:alert(1)",
        "tube example.org",
        "user:pw@tube.example.org",
        "tube.example.org/path",
        "-bad.example.org",
      ].join(","),
    );
    assert.deepEqual([...hosts], []);
  });

  it("is empty for an unset variable", () => {
    assert.equal(parsePeerTubeInstances(undefined).size, 0);
    assert.equal(parsePeerTubeInstances("").size, 0);
  });
});

describe("parsePeerTubeAssetId", () => {
  it("splits host and video id", () => {
    assert.deepEqual(parsePeerTubeAssetId(`Tube.Example.org/${UUID}`), {
      host: HOST,
      videoId: UUID,
    });
    assert.deepEqual(parsePeerTubeAssetId(`${HOST}/wiGGjHcDBjwMXQqmWHG1U8`), {
      host: HOST,
      videoId: "wiGGjHcDBjwMXQqmWHG1U8",
    });
  });

  it("rejects malformed ids", () => {
    for (const id of [
      "",
      HOST,
      `/${UUID}`,
      `${HOST}/`,
      `${HOST}/a/b`,
      `${HOST}/a b`,
      `${HOST}/${UUID}?x=1`,
      `localhost/${UUID}`,
    ]) {
      assert.equal(parsePeerTubeAssetId(id), null, id);
    }
  });
});

describe("createPeerTubeAdapter: instance allowlist", () => {
  it("is off when no instance is allowed (no request made)", async () => {
    const { adapter, calls } = adapterFor({}, []);
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(isAdapterFailure(result));
    assert.match(result.reason, /PEERTUBE_ALLOWED_INSTANCES/);
    assert.equal(calls.length, 0);
  });

  it("refuses hosts that are not allowed (no request made)", async () => {
    const { adapter, calls } = adapterFor({}, ["other.example.org"]);
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(isAdapterFailure(result));
    assert.match(result.reason, /tube\.example\.org/);
    assert.equal(calls.length, 0);
  });

  it("refuses malformed asset ids (no request made)", async () => {
    const { adapter, calls } = adapterFor({});

    for (const id of ["", UUID, `${HOST}/../x`, `${HOST}/a/b`]) {
      assert.ok(isAdapterFailure(await adapter.resolve(id, signal())), id);
    }
    assert.equal(calls.length, 0);
  });

  it("matches the host case-insensitively", async () => {
    const { adapter } = adapterFor({}, ["TUBE.Example.org"]);
    assert.ok(!isAdapterFailure(await adapter.resolve(ASSET_ID, signal())));
  });
});

describe("createPeerTubeAdapter: gate", () => {
  for (const id of [1, 2, 3, 7, 8]) {
    it(`accepts licence ${id}`, async () => {
      const { adapter } = adapterFor({ details: video({ licence: { id, label: "x" } }) });
      assert.ok(!isAdapterFailure(await adapter.resolve(ASSET_ID, signal())));
    });
  }

  const rejections: [string, Record<string, unknown>][] = [
    ["licence 4 (non-commercial)", { licence: { id: 4, label: "BY-NC" } }],
    ["licence 5", { licence: { id: 5, label: "BY-NC-SA" } }],
    ["licence 6", { licence: { id: 6, label: "BY-NC-ND" } }],
    ["licence 9 (all rights reserved)", { licence: { id: 9, label: "All Rights Reserved" } }],
    ["a null licence", { licence: null }],
    ["a missing licence", { licence: undefined }],
    ["a licence without id", { licence: { label: "Attribution" } }],
    ["unlisted privacy", { privacy: { id: 2, label: "Unlisted" } }],
    ["private privacy", { privacy: { id: 3, label: "Private" } }],
    ["internal privacy", { privacy: { id: 4, label: "Internal" } }],
    ["password-protected privacy", { privacy: { id: 5, label: "Password protected" } }],
    ["missing privacy", { privacy: undefined }],
    ["a video still transcoding", { state: { id: 2, label: "To transcode" } }],
    ["a missing state", { state: undefined }],
    ["a live", { isLive: true }],
    ["a missing isLive flag", { isLive: undefined }],
  ];

  for (const [reason, overrides] of rejections) {
    it(`refuses ${reason}`, async () => {
      const { adapter, calls } = adapterFor({ details: video(overrides) });
      const result = await adapter.resolve(ASSET_ID, signal());

      assert.ok(isAdapterFailure(result), "must fail closed");
      assert.ok(result.reason.length > 0);
      assert.ok(
        calls.every((url) => !url.endsWith("/captions")),
        "no further requests after a refusal",
      );
    });
  }
});

describe("createPeerTubeAdapter: formats", () => {
  it("prefers the HLS master playlist and attributes the work", async () => {
    const { adapter, calls } = adapterFor({
      details: video({
        files: [{ fileUrl: "https://tube.example.org/a-720.mp4", height: 720 }],
      }),
    });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.deepEqual(result, {
      type: "hls",
      url: HLS_URL,
      mimeType: "application/vnd.apple.mpegurl",
      label: "PeerTube",
      attribution: {
        sourceUrl: `https://${HOST}/w/wiGGjHcDBjwMXQqmWHG1U8`,
        license: "Attribution",
        author: "Alice",
      },
    });
    assert.equal(calls[0], `https://${HOST}/api/v1/videos/${UUID}`);
  });

  it("credits the channel when there is no account name, and falls back to the uuid", async () => {
    const { adapter } = adapterFor({
      details: video({ account: {}, shortUUID: undefined }),
    });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(result.attribution?.author, "Alice's channel");
    assert.equal(result.attribution?.sourceUrl, `https://${HOST}/w/${UUID}`);
  });

  it("falls back to the best MP4 up to 1080p, with sorted qualities", async () => {
    const { adapter } = adapterFor({
      details: video({
        streamingPlaylists: [],
        files: [
          { fileUrl: "https://tube.example.org/v-480.mp4", height: 480, hasVideo: true },
          { fileUrl: "https://tube.example.org/v-2160.mp4", height: 2160 },
          { fileUrl: "https://tube.example.org/v-1080.mp4", height: 1080 },
          // No "height": the resolution id is the height.
          { fileUrl: "https://tube.example.org/v-720.mp4", resolution: { id: 720 } },
          // Audio only.
          { fileUrl: "https://tube.example.org/a.mp4", height: 0, hasVideo: false },
          { fileUrl: "https://tube.example.org/b.mp4", resolution: { id: 0 } },
          // Not https.
          { fileUrl: "http://tube.example.org/v-360.mp4", height: 360 },
          { fileUrl: "javascript:alert(1)", height: 240 },
        ],
      }),
    });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(result.type, "direct");
    assert.equal(result.mimeType, "video/mp4");
    assert.equal(result.url, "https://tube.example.org/v-1080.mp4");
    assert.deepEqual(result.qualities, [
      { label: "1080p", height: 1080, url: "https://tube.example.org/v-1080.mp4" },
      { label: "720p", height: 720, url: "https://tube.example.org/v-720.mp4" },
      { label: "480p", height: 480, url: "https://tube.example.org/v-480.mp4" },
    ]);
  });

  it("ignores an HLS playlist that is not https and uses the MP4", async () => {
    const { adapter } = adapterFor({
      details: video({
        streamingPlaylists: [{ type: 1, playlistUrl: "http://tube.example.org/m.m3u8" }],
        files: [{ fileUrl: "https://tube.example.org/v-720.mp4", height: 720 }],
      }),
    });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(result.type, "direct");
  });

  it("refuses a video with no usable https stream", async () => {
    const { adapter } = adapterFor({
      details: video({
        streamingPlaylists: [{ type: 1, playlistUrl: "http://tube.example.org/m.m3u8" }],
        files: [
          { fileUrl: "http://tube.example.org/v-720.mp4", height: 720 },
          { fileUrl: "https://tube.example.org/v-4k.mp4", height: 2160 },
        ],
      }),
    });
    assert.ok(isAdapterFailure(await adapter.resolve(ASSET_ID, signal())));
  });

  it("refuses media served from a host that is not allowlisted", async () => {
    const { adapter } = adapterFor({
      details: video({
        streamingPlaylists: [
          { type: 1, playlistUrl: "https://evil.example/streaming/master.m3u8" },
        ],
        files: [{ fileUrl: "https://evil.example/v-720.mp4", height: 720 }],
      }),
    });
    assert.ok(isAdapterFailure(await adapter.resolve(ASSET_ID, signal())));
  });

  it("accepts media served from another allowlisted host", async () => {
    const { adapter } = adapterFor(
      {
        details: video({
          streamingPlaylists: [],
          files: [{ fileUrl: "https://media.example.org/v-720.mp4", height: 720 }],
        }),
      },
      [HOST, "media.example.org"],
    );
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(result.url, "https://media.example.org/v-720.mp4");
  });

  it("refuses playlists that are not HLS", async () => {
    const { adapter } = adapterFor({
      details: video({ streamingPlaylists: [{ type: 2, playlistUrl: HLS_URL }] }),
    });
    assert.ok(isAdapterFailure(await adapter.resolve(ASSET_ID, signal())));
  });
});

describe("createPeerTubeAdapter: subtitles", () => {
  const origin = `https://${HOST}`;

  it("keeps only https .vtt tracks and resolves captionPath against the host", async () => {
    const { adapter, calls } = adapterFor({
      captions: {
        total: 6,
        data: [
          {
            language: { id: "pt", label: "Português" },
            fileUrl: `${origin}/lazy-static/video-captions/pt.vtt`,
            captionPath: "/lazy-static/video-captions/ignored.vtt",
          },
          {
            language: { id: "en", label: "English" },
            captionPath: "/lazy-static/video-captions/en.vtt",
          },
          { language: { id: "fr", label: "Français" }, captionPath: "/captions/fr.srt" },
          { language: { id: "de", label: "Deutsch" }, fileUrl: "http://evil.example/de.vtt" },
          { language: { id: "es", label: "Español" }, fileUrl: "javascript:alert(1)" },
          { language: { id: "it", label: "Italiano" }, fileUrl: "https://evil.example/it.vtt" },
          { language: { label: "no id" }, captionPath: "/captions/x.vtt" },
        ],
      },
    });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(!isAdapterFailure(result));
    assert.deepEqual(result.subtitles, [
      {
        language: "pt",
        label: "Português",
        url: `${origin}/lazy-static/video-captions/pt.vtt`,
      },
      {
        language: "en",
        label: "English",
        url: `${origin}/lazy-static/video-captions/en.vtt`,
      },
    ]);
    assert.equal(calls[1], `${origin}/api/v1/videos/${UUID}/captions`);
  });

  it("omits subtitles when there are none", async () => {
    const { adapter } = adapterFor({});
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal("subtitles" in result, false);
  });

  it("still resolves the video when the captions request fails", async () => {
    for (const captions of [
      () => new Response("down", { status: 500 }),
      () => {
        throw new TypeError("fetch failed");
      },
      () => new Response("not json", { status: 200 }),
      () => json({ data: "nope" }),
    ]) {
      const { adapter } = adapterFor({ captions });
      const result = await adapter.resolve(ASSET_ID, signal());

      assert.ok(!isAdapterFailure(result));
      assert.equal(result.url, HLS_URL);
      assert.equal("subtitles" in result, false);
    }
  });
});

describe("createPeerTubeAdapter: remote failures", () => {
  it("turns HTTP errors, network errors and bad JSON into a reason", async () => {
    const failures: (() => Response)[] = [
      () => new Response("missing", { status: 404 }),
      () => new Response("slow down", { status: 429 }),
      () => {
        throw new TypeError("fetch failed");
      },
      () => new Response("<html>", { status: 200 }),
      () => json([]),
      () => json(null),
    ];

    for (const details of failures) {
      const { adapter } = adapterFor({ details });
      assert.ok(isAdapterFailure(await adapter.resolve(ASSET_ID, signal())));
    }
  });

  it("never follows a redirect to another host", async () => {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      });
    }) as typeof fetch;
    const adapter = createPeerTubeAdapter({ fetchImpl: impl, allowedInstances: [HOST] });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(isAdapterFailure(result));
    assert.equal(calls.length, 1);
  });

  it("refuses a response larger than the metadata cap", async () => {
    const impl = (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(64 * 1024 * 1024) },
      })) as typeof fetch;
    const adapter = createPeerTubeAdapter({ fetchImpl: impl, allowedInstances: [HOST] });
    const result = await adapter.resolve(ASSET_ID, signal());

    assert.ok(isAdapterFailure(result));
    assert.match(result.reason, /grande demais/);
  });

  it("exposes id, label and an asset hint", () => {
    const adapter = createPeerTubeAdapter();
    assert.equal(adapter.id, "peertube");
    assert.ok(adapter.label.length > 0);
    assert.match(adapter.assetIdHint, /PEERTUBE_ALLOWED_INSTANCES/);
  });
});
