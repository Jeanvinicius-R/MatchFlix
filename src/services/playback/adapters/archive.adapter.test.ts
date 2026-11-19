import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAdapterFailure,
  type DiscoveryQuery,
  type PlaybackAdapter,
} from "./adapter.types";
import { createArchiveAdapter, parseAllowedLicense, pickVideoFile } from "./archive.adapter";

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url);
  }) as typeof fetch;

  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CC_BY = "http://creativecommons.org/licenses/by/3.0/";

function item(
  metadata: Record<string, unknown> = {},
  files: unknown[] = [
    { name: "film.mp4", format: "h.264", source: "derivative", size: "1000" },
  ],
  extra: Record<string, unknown> = {},
) {
  return {
    metadata: {
      mediatype: "movies",
      licenseurl: CC_BY,
      creator: "Blender Foundation",
      collection: ["opensource_movies"],
      ...metadata,
    },
    files,
    ...extra,
  };
}

function signal() {
  return { signal: new AbortController().signal };
}

describe("parseAllowedLicense", () => {
  const accepted: [string, string][] = [
    ["http://creativecommons.org/publicdomain/mark/1.0/", "Domínio público (PDM 1.0)"],
    ["https://creativecommons.org/publicdomain/zero/1.0", "CC0 1.0"],
    ["http://creativecommons.org/licenses/publicdomain/", "Domínio público"],
    ["http://creativecommons.org/publicdomain/", "Domínio público"],
    ["http://creativecommons.org/licenses/by/3.0/", "CC BY 3.0"],
    ["https://creativecommons.org/licenses/by/2.5", "CC BY 2.5"],
    ["https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0"],
    ["https://www.creativecommons.org/licenses/by-sa/4.0/", "CC BY-SA 4.0"],
    ["http://creativecommons.org/licenses/by/3.0/us/", "CC BY 3.0 US"],
    ["  http://creativecommons.org/licenses/by-sa/3.0/br/ ", "CC BY-SA 3.0 BR"],
  ];

  for (const [url, label] of accepted) {
    it(`accepts ${url.trim()}`, () => {
      assert.equal(parseAllowedLicense(url), label);
    });
  }

  const rejected = [
    "http://creativecommons.org/licenses/by-nc/3.0/",
    "https://creativecommons.org/licenses/by-nd/4.0/",
    "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "https://creativecommons.org/licenses/by-nc-nd/2.0/",
    "https://creativecommons.org/licenses/by/3.0/deed.en",
    "https://creativecommons.org/licenses/by-sa/3.0/../by-nc/3.0/",
    "https://creativecommons.org/licenses/by/",
    "https://creativecommons.org/licenses/sampling/1.0/",
    "https://creativecommons.org.evil.example/licenses/by/3.0/",
    "https://example.org/licenses/by/3.0/",
    "https://user:secret@creativecommons.org/licenses/by/3.0/",
    "https://creativecommons.org:8443/licenses/by/3.0/",
    "http://www.creativecommons.org:1/publicdomain/zero/1.0/",
    "ftp://creativecommons.org/licenses/by/3.0/",
    "javascript:alert(1)",
    "All rights reserved",
    "",
  ];

  for (const url of rejected) {
    it(`rejects "${url}"`, () => {
      assert.equal(parseAllowedLicense(url), null);
    });
  }
});

describe("pickVideoFile", () => {
  it("prefers H.264 over MPEG4, then derivatives over originals, then the largest", () => {
    const name = pickVideoFile([
      { name: "a_512kb.mp4", format: "512Kb MPEG4", source: "derivative", size: "999999" },
      { name: "b_original.mp4", format: "h.264", source: "original", size: "999999999" },
      { name: "c.mp4", format: "h.264", source: "derivative", size: "100" },
      { name: "d.mp4", format: "h.264 IA", source: "derivative", size: "200" },
    ]);
    assert.equal(name, "d.mp4");
  });

  it("falls back to MPEG4 when there is no H.264", () => {
    const name = pickVideoFile([
      { name: "movie.ogv", format: "Ogg Video", source: "derivative", size: "1" },
      { name: "movie_512kb.mp4", format: "512Kb MPEG4", source: "derivative", size: "5" },
    ]);
    assert.equal(name, "movie_512kb.mp4");
  });

  it("ignores samples, thumbnails, trailers and non-MP4 files", () => {
    const name = pickVideoFile([
      { name: "film_sample.mp4", format: "h.264", source: "derivative", size: "9000" },
      { name: "film_trailer.mp4", format: "h.264", source: "derivative", size: "9000" },
      { name: "film.thumbs/frame.mp4", format: "h.264", source: "derivative", size: "9000" },
      { name: "film.avi", format: "Cinepack", source: "original", size: "9000" },
      { name: "film.torrent", format: "Archive BitTorrent", source: "metadata" },
      { name: "film.jpg", format: "Thumbnail", source: "derivative" },
      { name: "film.mp4", format: "h.264", source: "derivative", size: "10" },
    ]);
    assert.equal(name, "film.mp4");
  });

  it("returns null when nothing is playable or entries are malformed", () => {
    assert.equal(pickVideoFile([]), null);
    assert.equal(pickVideoFile([null, "x", 3, { format: "h.264" }, { name: 5 }]), null);
    assert.equal(
      pickVideoFile([{ name: "film.mp4", source: "derivative", size: "1" }]),
      null,
      "an MP4 without a known video format is not trusted",
    );
  });

  it("never returns a path that escapes the item", () => {
    assert.equal(
      pickVideoFile([{ name: "../film.mp4", format: "h.264", source: "derivative" }]),
      null,
    );
  });
});

describe("createArchiveAdapter", () => {
  it("resolves an open item to a direct https MP4 with attribution", async () => {
    const { impl, calls } = fakeFetch(() => json(item()));
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve(
      "BigBuckBunny_124",
      signal(),
    );

    assert.equal(isAdapterFailure(result), false);
    assert.deepEqual(result, {
      type: "direct",
      url: "https://archive.org/download/BigBuckBunny_124/film.mp4",
      mimeType: "video/mp4",
      label: "Internet Archive",
      attribution: {
        license: "CC BY 3.0",
        sourceUrl: "https://archive.org/details/BigBuckBunny_124",
        author: "Blender Foundation",
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://archive.org/metadata/BigBuckBunny_124");
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.match(headers["User-Agent"], /^MatchFlix\/1\.0 \(\+https:\/\/github\.com\//);
  });

  it("encodes each path segment of the file name", async () => {
    const files = [
      { name: "Content/big buck #1.mp4", format: "h.264", source: "derivative", size: "9" },
    ];
    const { impl } = fakeFetch(() => json(item({}, files)));
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(
      result.url,
      "https://archive.org/download/abc/Content/big%20buck%20%231.mp4",
    );
  });

  it("joins several creators", async () => {
    const { impl } = fakeFetch(() => json(item({ creator: ["A", "B"] })));
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(result.attribution?.author, "A, B");
  });

  const refusals: [string, Record<string, unknown>][] = [
    ["has no licenseurl", { licenseurl: undefined, rights: "Public domain" }],
    ["has an empty licenseurl", { licenseurl: "  " }],
    ["is non-commercial", { licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/" }],
    ["is no-derivatives", { licenseurl: "https://creativecommons.org/licenses/by-nd/4.0/" }],
    ["has an unknown license", { licenseurl: "https://example.org/my-license" }],
    ["has a non-string licenseurl", { licenseurl: ["http://creativecommons.org/licenses/by/3.0/"] }],
    ["is not a movie", { mediatype: "audio" }],
    ["has no mediatype", { mediatype: undefined }],
    ["is access-restricted", { "access-restricted-item": "true" }],
    ["is borrow-only", { collection: ["opensource_movies", "inlibrary"] }],
    ["is print-disabled", { collection: "printdisabled" }],
  ];

  for (const [reason, overrides] of refusals) {
    it(`refuses an item that ${reason}`, async () => {
      const { impl } = fakeFetch(() => json(item(overrides)));
      const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());

      assert.ok(isAdapterFailure(result), "must fail closed");
      assert.ok(result.reason.length > 0);
    });
  }

  it("refuses a dark item", async () => {
    const { impl } = fakeFetch(() => json(item({}, undefined, { is_dark: true })));
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());
    assert.ok(isAdapterFailure(result));
  });

  it("refuses an item with no playable file", async () => {
    const files = [{ name: "film.avi", format: "Cinepack", source: "original" }];
    const { impl } = fakeFetch(() => json(item({}, files)));
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());
    assert.ok(isAdapterFailure(result));
  });

  it("refuses a missing item ([] and {})", async () => {
    for (const body of [[], {}]) {
      const { impl } = fakeFetch(() => json(body));
      const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());
      assert.ok(isAdapterFailure(result));
    }
  });

  it("refuses malformed identifiers without any request", async () => {
    const { impl, calls } = fakeFetch(() => json(item()));
    const adapter = createArchiveAdapter({ fetchImpl: impl });

    for (const id of ["", "-abc", "a/b", "a b", "a?x=1", "../etc", "a\\b", "é"]) {
      assert.ok(isAdapterFailure(await adapter.resolve(id, signal())), id);
    }
    assert.equal(calls.length, 0);
  });

  it("turns HTTP errors, network errors and bad JSON into a reason", async () => {
    const adapter = (handler: () => Response | Promise<Response>) =>
      createArchiveAdapter({ fetchImpl: fakeFetch(handler).impl });

    const http = await adapter(() => new Response("nope", { status: 503 })).resolve(
      "abc",
      signal(),
    );
    assert.ok(isAdapterFailure(http));
    assert.match(http.reason, /503/);

    const network = await adapter(() => {
      throw new TypeError("fetch failed");
    }).resolve("abc", signal());
    assert.ok(isAdapterFailure(network));

    const garbage = await adapter(() => new Response("<html>", { status: 200 })).resolve(
      "abc",
      signal(),
    );
    assert.ok(isAdapterFailure(garbage));
  });

  it("follows a redirect only inside archive.org", async () => {
    const dataServer = "https://ia800000.us.archive.org/metadata/abc";
    const { impl, calls } = fakeFetch((url) =>
      url === dataServer
        ? json(item())
        : new Response(null, { status: 302, headers: { location: dataServer } }),
    );
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());

    assert.ok(!isAdapterFailure(result));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, dataServer);
  });

  it("refuses redirects to other hosts or to plain http", async () => {
    for (const location of [
      "https://169.254.169.254/latest/meta-data/",
      "https://archive.org.evil.example/metadata/abc",
      "http://archive.org/metadata/abc",
    ]) {
      const { impl, calls } = fakeFetch(
        () => new Response(null, { status: 302, headers: { location } }),
      );
      const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", signal());

      assert.ok(isAdapterFailure(result), location);
      assert.equal(calls.length, 1, location);
    }
  });

  it("reports a timeout when the signal aborted", async () => {
    const { impl } = fakeFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    const result = await createArchiveAdapter({ fetchImpl: impl }).resolve("abc", {
      signal: AbortSignal.abort(),
    });

    assert.ok(isAdapterFailure(result));
    assert.match(result.reason, /a tempo/);
  });

  it("exposes id, label and an asset hint", () => {
    const adapter = createArchiveAdapter();
    assert.equal(adapter.id, "archive");
    assert.ok(adapter.label.length > 0);
    assert.ok(adapter.assetIdHint.length > 0);
  });
});

function searchBody(docs: unknown[]) {
  return { responseHeader: { status: 0 }, response: { numFound: docs.length, docs } };
}

const BBB_QUERY: DiscoveryQuery = {
  tmdbId: 10378,
  mediaType: "MOVIE",
  seasonNumber: 0,
  episodeNumber: 0,
  title: "Big Buck Bunny",
  originalTitle: "Big Buck Bunny",
  year: 2008,
  runtimeMinutes: 10,
};

async function discoverWith(adapter: PlaybackAdapter, query: DiscoveryQuery) {
  assert.ok(adapter.discover, "the adapter should implement discover()");
  return adapter.discover(query, signal());
}

describe("archive adapter discover()", () => {
  it("searches advancedsearch by title and returns only allowed licenses as candidates", async () => {
    const { impl, calls } = fakeFetch(() =>
      json(
        searchBody([
          {
            identifier: "BigBuckBunny_124",
            title: "Big Buck Bunny",
            year: "2008",
            licenseurl: CC_BY,
            runtime: "00:09:56",
          },
          {
            identifier: "bbb-nc",
            title: "Big Buck Bunny (non commercial)",
            year: 2008,
            licenseurl: "https://creativecommons.org/licenses/by-nc/3.0/",
          },
          { identifier: "bbb-nolicense", title: "Big Buck Bunny", year: 2008 },
          { identifier: "../bad", title: "Big Buck Bunny", licenseurl: CC_BY },
          { identifier: "dup", title: "Dup", licenseurl: CC_BY, date: "1999-04-01T00:00:00Z" },
          { identifier: "dup", title: "Dup again", licenseurl: CC_BY },
          "garbage",
        ]),
      ),
    );
    const result = await discoverWith(createArchiveAdapter({ fetchImpl: impl }), BBB_QUERY);

    assert.ok(Array.isArray(result));
    assert.deepEqual(result, [
      {
        providerAssetId: "BigBuckBunny_124",
        title: "Big Buck Bunny",
        year: 2008,
        durationMinutes: (9 * 60 + 56) / 60,
      },
      { providerAssetId: "dup", title: "Dup", year: 1999 },
    ]);
    assert.equal(calls.length, 1);

    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, "https://archive.org/advancedsearch.php");
    assert.equal(url.searchParams.get("output"), "json");
    assert.equal(url.searchParams.get("q"), '(title:("Big Buck Bunny")) AND mediatype:movies');
    assert.ok(url.searchParams.getAll("fl[]").includes("licenseurl"));
    assert.ok(Number(url.searchParams.get("rows")) <= 25);
  });

  it("never produces an identifier match (the Archive declares none we trust)", async () => {
    const { impl } = fakeFetch(() =>
      json(searchBody([{ identifier: "abc", title: "Film", year: 2000, licenseurl: CC_BY }])),
    );
    const result = await discoverWith(createArchiveAdapter({ fetchImpl: impl }), BBB_QUERY);

    assert.ok(Array.isArray(result));
    assert.equal(result[0].externalIds, undefined);
  });

  it("searches both titles and strips quotes from the phrase", async () => {
    const { impl, calls } = fakeFetch(() => json(searchBody([])));
    const result = await discoverWith(createArchiveAdapter({ fetchImpl: impl }), {
      ...BBB_QUERY,
      title: 'O "Grande" Coelho',
      originalTitle: "Big Buck Bunny",
    });

    assert.deepEqual(result, []);
    assert.equal(
      new URL(calls[0].url).searchParams.get("q"),
      '(title:("O Grande Coelho") OR title:("Big Buck Bunny")) AND mediatype:movies',
    );
  });

  it("parses runtimes given as mm:ss or seconds and ignores nonsense", async () => {
    const { impl } = fakeFetch(() =>
      json(
        searchBody([
          { identifier: "a", title: "A", licenseurl: CC_BY, runtime: "9:56" },
          { identifier: "b", title: "B", licenseurl: CC_BY, runtime: "600" },
          { identifier: "c", title: "C", licenseurl: CC_BY, runtime: "soon" },
        ]),
      ),
    );
    const result = await discoverWith(createArchiveAdapter({ fetchImpl: impl }), BBB_QUERY);

    assert.ok(Array.isArray(result));
    assert.equal(result[0].durationMinutes, (9 * 60 + 56) / 60);
    assert.equal(result[1].durationMinutes, 10);
    assert.equal(result[2].durationMinutes, undefined);
  });

  it("does not search for episodes", async () => {
    const { impl, calls } = fakeFetch(() => json(searchBody([])));
    const result = await discoverWith(createArchiveAdapter({ fetchImpl: impl }), {
      ...BBB_QUERY,
      mediaType: "EPISODE",
      seasonNumber: 1,
      episodeNumber: 2,
    });

    assert.deepEqual(result, []);
    assert.equal(calls.length, 0);
  });

  it("fails closed on HTTP errors and malformed bodies", async () => {
    const down = fakeFetch(() => new Response("nope", { status: 503 }));
    const bad = fakeFetch(() => json({ response: { docs: "x" } }));
    const failed = await discoverWith(createArchiveAdapter({ fetchImpl: down.impl }), BBB_QUERY);
    const garbage = await discoverWith(createArchiveAdapter({ fetchImpl: bad.impl }), BBB_QUERY);

    assert.ok(!Array.isArray(failed));
    assert.match(failed.reason, /HTTP 503/);
    assert.ok(!Array.isArray(garbage));
    assert.match(garbage.reason, /inválida/);
  });
});
