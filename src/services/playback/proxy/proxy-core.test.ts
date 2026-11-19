import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleProxyRequest,
  MAX_MANIFEST_BYTES,
  onStreamEnd,
  type ProxyRequest,
  type ProxyResult,
} from "./proxy-core";
import {
  mintProxyToken,
  PROXY_PATH_PREFIX,
  readProxyToken,
  resolveProxyTtlSeconds,
  type ProxyTokenInput,
} from "./proxy-token";

const SECRET = "proxy-core-test-secret";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const USER = "user-1";
const ASSOCIATION = "assoc-1";
const MEDIA_ORIGIN = "https://media.example.org";
const CDN_ORIGIN = "https://cdn.example.org";
const FILM_URL = `${MEDIA_ORIGIN}/vod/42/film.mp4?api_key=hunter2-key`;
const MASTER_URL = `${MEDIA_ORIGIN}/vod/42/master.m3u8?api_key=hunter2-key`;
const AUTH_HEADERS = { Authorization: "Bearer hunter2-token" };

interface Call {
  url: string;
  method: string;
  headers: Headers;
  signal: AbortSignal | null | undefined;
  redirect: RequestRedirect | undefined;
}

type Handler = (call: Call, index: number) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      signal: init?.signal,
      redirect: init?.redirect,
    };

    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;

  return { calls, fetchImpl };
}

function mint(overrides: Partial<ProxyTokenInput> = {}): string {
  return mintProxyToken(
    {
      upstreamUrl: FILM_URL,
      headers: AUTH_HEADERS,
      allowedOrigins: [MEDIA_ORIGIN],
      userId: USER,
      associationId: ASSOCIATION,
      ...overrides,
    },
    { now: NOW, secret: SECRET },
  );
}

async function run(
  handler: Handler,
  overrides: Partial<ProxyRequest> = {},
  tokenOverrides: Partial<ProxyTokenInput> = {},
) {
  const fake = fakeFetch(handler);
  const result = await handleProxyRequest({
    method: "GET",
    token: mint(tokenOverrides),
    viewerId: USER,
    isAssociationPlayable: async () => true,
    fetchImpl: fake.fetchImpl,
    now: NOW,
    secret: SECRET,
    ...overrides,
  });

  return { result, calls: fake.calls };
}

async function bodyText(result: ProxyResult): Promise<string> {
  if (result.body === null) {
    return "";
  }

  if (typeof result.body === "string") {
    return result.body;
  }

  return new Response(result.body).text();
}

function video(body = "video-bytes", init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "video/mp4", ...(init.headers as Record<string, string>) },
  });
}

const SAFE_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "x-content-type-options",
];

describe("handleProxyRequest: access control", () => {
  it("serves only GET and HEAD, and never contacts the upstream otherwise", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const { result, calls } = await run(() => video(), { method });

      assert.equal(result.status, 405, method);
      assert.equal(result.headers.allow, "GET, HEAD");
      assert.equal(calls.length, 0, method);
    }
  });

  it("is case-insensitive about the method", async () => {
    const { result } = await run(() => video(), { method: "get" });

    assert.equal(result.status, 200);
  });

  it("requires a signed-in viewer", async () => {
    const { result, calls } = await run(() => video(), { viewerId: undefined });

    assert.equal(result.status, 401);
    assert.equal(calls.length, 0);
  });

  it("answers 404 for tokens that are invalid, expired or minted with another secret", async () => {
    const cases: Partial<ProxyRequest>[] = [
      { token: "A".repeat(80) },
      { token: "" },
      { token: `${mint()}x` },
      { secret: "another-secret" },
      { now: NOW + 7 * 60 * 60 * 1000 },
    ];

    for (const overrides of cases) {
      const { result, calls } = await run(() => video(), overrides);

      assert.equal(result.status, 404);
      assert.equal(calls.length, 0);
    }
  });

  it("refuses a token minted for another user (403) without contacting the upstream", async () => {
    const { result, calls } = await run(() => video(), { viewerId: "user-2" });

    assert.equal(result.status, 403);
    assert.equal(calls.length, 0);
    assert.ok(!(await bodyText(result)).includes("media.example.org"));
  });
});

describe("handleProxyRequest: association revocation", () => {
  it("asks the database about the token's association on every request", async () => {
    const asked: string[] = [];
    const overrides: Partial<ProxyRequest> = {
      isAssociationPlayable: async (id) => {
        asked.push(id);
        return true;
      },
    };

    await run(() => video(), overrides, { associationId: "assoc-9" });
    await run(() => video(), overrides, { associationId: "assoc-9" });

    assert.deepEqual(asked, ["assoc-9", "assoc-9"]);
  });

  it("answers 410 and fetches nothing once the association stops being playable", async () => {
    let playable = true;
    const overrides: Partial<ProxyRequest> = { isAssociationPlayable: async () => playable };
    const token = mint();

    const before = await run(() => video(), { ...overrides, token });
    assert.equal(before.result.status, 200);
    assert.equal(before.calls.length, 1);

    playable = false;
    const after = await run(() => video(), { ...overrides, token });

    assert.equal(after.result.status, 410);
    assert.equal(after.calls.length, 0);
    assert.equal(after.result.body !== null && typeof after.result.body === "string", true);
    assert.ok(!(await bodyText(after.result)).includes("media.example.org"));
  });

  it("answers 410 for an HLS child token too (children inherit the association)", async () => {
    const manifest = await run(
      () =>
        new Response("#EXTM3U\n#EXTINF:6,\nseg0.ts\n", {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        }),
      {},
      { upstreamUrl: MASTER_URL },
    );
    const [childToken] = childTokens(await bodyText(manifest.result));

    const revoked = await run(() => video(), {
      token: childToken,
      isAssociationPlayable: async (id) => id !== ASSOCIATION,
    });

    assert.equal(revoked.result.status, 410);
    assert.equal(revoked.calls.length, 0);
  });

  it("fails closed (503, no upstream contact) when the database check fails", async () => {
    const { result, calls } = await run(() => video(), {
      isAssociationPlayable: async () => {
        throw new Error("connection refused");
      },
    });

    assert.equal(result.status, 503);
    assert.equal(calls.length, 0);
    assert.ok(!(await bodyText(result)).includes("connection refused"));
  });

  it("checks the association only after the token and the user are validated", async () => {
    let asked = 0;
    const isAssociationPlayable = async () => {
      asked += 1;
      return true;
    };

    await run(() => video(), { isAssociationPlayable, viewerId: "someone-else" });
    await run(() => video(), { isAssociationPlayable, token: "A".repeat(80) });
    await run(() => video(), { isAssociationPlayable, method: "POST" });

    assert.equal(asked, 0);
  });
});

describe("handleProxyRequest: media passthrough", () => {
  it("forwards Range and If-Range and passes a 206 through", async () => {
    const { result, calls } = await run(
      () =>
        video("x".repeat(100), {
          status: 206,
          headers: {
            "content-range": "bytes 100-199/1000",
            "content-length": "100",
            "accept-ranges": "bytes",
            etag: '"etag-1"',
            "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
          },
        }),
      { rangeHeader: "bytes=100-199", ifRangeHeader: '"etag-1"' },
    );

    assert.equal(result.status, 206);
    assert.equal(calls[0].headers.get("range"), "bytes=100-199");
    assert.equal(calls[0].headers.get("if-range"), '"etag-1"');
    assert.equal(result.headers["content-range"], "bytes 100-199/1000");
    assert.equal(result.headers["accept-ranges"], "bytes");
    assert.equal(result.headers.etag, '"etag-1"');
    assert.equal((await bodyText(result)).length, 100);
  });

  it("supports open-ended and suffix ranges and ignores malformed ones", async () => {
    for (const range of ["bytes=0-", "bytes=-500", "bytes=10-20"]) {
      const { calls } = await run(() => video(), { rangeHeader: range });
      assert.equal(calls[0].headers.get("range"), range, range);
    }

    for (const range of ["bytes=0-1,5-6", "items=0-1", "bytes=-", "bytes=a-b", "", "bytes=0-1\r\nX: y"]) {
      const { calls } = await run(() => video(), { rangeHeader: range, ifRangeHeader: '"x"' });
      assert.equal(calls[0].headers.get("range"), null, range);
      assert.equal(calls[0].headers.get("if-range"), null, range);
    }
  });

  it("does not forward If-Range without a valid Range", async () => {
    const { calls } = await run(() => video(), { ifRangeHeader: '"etag"' });

    assert.equal(calls[0].headers.get("if-range"), null);
  });

  it("passes a 416 with its Content-Range and no body", async () => {
    const { result } = await run(
      () => new Response(null, { status: 416, headers: { "content-range": "bytes */1000" } }),
      { rangeHeader: "bytes=5000-" },
    );

    assert.equal(result.status, 416);
    assert.equal(result.headers["content-range"], "bytes */1000");
    assert.equal(result.body, null);
  });

  it("answers HEAD with the headers and no body", async () => {
    const { result, calls } = await run(
      () => video("", { headers: { "content-length": "1234", "accept-ranges": "bytes" } }),
      { method: "HEAD" },
    );

    assert.equal(calls[0].method, "HEAD");
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-length"], "1234");
    assert.equal(result.headers["content-type"], "video/mp4");
    assert.equal(result.body, null);
  });

  it("streams the body through", async () => {
    const { result } = await run(() => video("hello-stream"));

    assert.ok(result.body instanceof ReadableStream);
    assert.equal(await bodyText(result), "hello-stream");
  });

  it("sends the server-side headers upstream, but never cookies or the browser's headers", async () => {
    const { calls } = await run(() => video());
    const headers = calls[0].headers;

    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].redirect, "manual");
    assert.equal(calls[0].url, FILM_URL);
    assert.equal(headers.get("authorization"), "Bearer hunter2-token");
    assert.equal(headers.get("accept-encoding"), "identity");
    assert.match(headers.get("user-agent") ?? "", /^MatchFlix\//);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("referer"), null);
    assert.equal(headers.get("origin"), null);
  });

  it("returns only whitelisted headers, plus no-store and nosniff", async () => {
    const { result } = await run(() =>
      video("data", {
        headers: {
          "content-length": "4",
          etag: '"e"',
          "set-cookie": "sid=secret; HttpOnly",
          server: "nginx/1.2",
          "x-powered-by": "PHP",
          "www-authenticate": 'Basic realm="x"',
          "access-control-allow-origin": "*",
          location: "https://evil.example.net/",
          "x-upstream-token": "hunter2",
          via: "1.1 proxy",
        },
      }),
    );

    for (const name of Object.keys(result.headers)) {
      assert.ok(SAFE_RESPONSE_HEADERS.includes(name), name);
    }

    assert.equal(result.headers["cache-control"], "private, no-store");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.ok(!JSON.stringify(result.headers).includes("hunter2"));
  });

  it("drops the content-length of a decoded body", async () => {
    const { result } = await run(() =>
      video("data", { headers: { "content-length": "99", "content-encoding": "gzip" } }),
    );

    assert.equal(result.headers["content-length"], undefined);
    assert.equal(result.headers["content-encoding"], undefined);
  });

  it("treats a missing content-type as application/octet-stream", async () => {
    // Bytes without a type: the runtime adds none, so the proxy defaults it.
    const { result } = await run(() => new Response(new Uint8Array([1, 2, 3])));

    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "application/octet-stream");

    // A text body makes the runtime add "text/plain", which is not media.
    const text = await run(() => new Response("data"));

    assert.equal(text.result.status, 502);
  });
});

describe("handleProxyRequest: content types", () => {
  const ALLOWED = [
    "video/mp4",
    "video/webm; codecs=vp9",
    "audio/mpeg",
    "audio/mp4",
    "application/octet-stream",
    "application/mp4",
    "text/vtt",
    "Video/MP4",
  ];
  const FORBIDDEN = [
    "text/html",
    "text/html; charset=utf-8",
    "application/json",
    "application/javascript",
    "text/javascript",
    "image/svg+xml",
    "application/xml",
    "text/plain",
    "application/x-shockwave-flash",
    "multipart/form-data",
  ];

  for (const type of ALLOWED) {
    it(`allows ${type}`, async () => {
      const { result } = await run(() => video("d", { headers: { "content-type": type } }));

      assert.equal(result.status, 200);
    });
  }

  for (const type of FORBIDDEN) {
    it(`refuses ${type} with a generic 502 and none of the upstream content`, async () => {
      const { result } = await run(
        () => video("<script>steal()</script>", { headers: { "content-type": type } }),
      );
      const text = await bodyText(result);

      assert.equal(result.status, 502);
      assert.ok(!text.includes("script"));
      assert.ok(!text.includes("media.example.org"));
    });
  }
});

describe("handleProxyRequest: upstream errors", () => {
  it("maps 404 to 404", async () => {
    const { result } = await run(() => new Response("nope", { status: 404 }));

    assert.equal(result.status, 404);
    assert.ok(!(await bodyText(result)).includes("nope"));
  });

  it("maps every other failure to a generic 502 without details", async () => {
    for (const status of [400, 401, 403, 410, 429, 500, 502, 503]) {
      const { result } = await run(
        () => new Response("secret upstream detail hunter2", { status }),
      );
      const text = await bodyText(result);

      assert.equal(result.status, 502, String(status));
      assert.ok(!text.includes("hunter2"), String(status));
      assert.ok(!text.includes("media.example.org"), String(status));
    }
  });

  it("answers 502 for a 204 with no content", async () => {
    const { result } = await run(() => new Response(null, { status: 204 }));

    assert.equal(result.status, 502);
  });

  it("answers 502 when the fetch throws, without the URL or credentials", async () => {
    const { result } = await run(() => {
      throw new TypeError(`fetch failed for ${FILM_URL}`);
    });
    const text = await bodyText(result);

    assert.equal(result.status, 502);
    assert.ok(!text.includes("hunter2"));
    assert.ok(!text.includes("media.example.org"));
  });

  it("answers 502 and never fetches when the client is already gone", async () => {
    const { result, calls } = await run(() => video(), { signal: AbortSignal.abort() });

    assert.equal(result.status, 502);
    assert.equal(calls.length, 0);
  });

  it("aborts the upstream when the client disconnects mid-stream", async () => {
    const client = new AbortController();
    const { result, calls } = await run(
      () =>
        new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }), {
          headers: { "content-type": "video/mp4" },
        }),
      { signal: client.signal },
    );

    assert.equal(result.status, 200);
    assert.equal(calls[0].signal?.aborted, false);

    client.abort();

    assert.equal(calls[0].signal?.aborted, true);
  });
});

describe("handleProxyRequest: origins and redirects", () => {
  const OTHER = { allowedOrigins: [MEDIA_ORIGIN, CDN_ORIGIN] };

  function redirect(location: string, status = 302) {
    return new Response(null, { status, headers: { location } });
  }

  it("follows a same-origin redirect and keeps the server-side headers", async () => {
    const { result, calls } = await run((_call, index) =>
      index === 0 ? redirect("/vod/42/real.mp4") : video(),
    );

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, `${MEDIA_ORIGIN}/vod/42/real.mp4`);
    assert.equal(calls[1].headers.get("authorization"), "Bearer hunter2-token");
  });

  it("follows a redirect to another ALLOWED origin but drops the credentials there", async () => {
    const { result, calls } = await run(
      (_call, index) => (index === 0 ? redirect(`${CDN_ORIGIN}/blob/film.mp4`, 307) : video()),
      { rangeHeader: "bytes=0-99" },
      OTHER,
    );

    assert.equal(result.status, 200);
    assert.equal(calls[1].url, `${CDN_ORIGIN}/blob/film.mp4`);
    assert.equal(calls[1].headers.get("authorization"), null);
    assert.equal(calls[1].headers.get("cookie"), null);
    // Range is not a credential: playback keeps seeking through the redirect.
    assert.equal(calls[1].headers.get("range"), "bytes=0-99");
  });

  it("refuses a redirect to an origin outside the token's list", async () => {
    for (const location of [
      "https://evil.example.net/x.mp4",
      "http://media.example.org/x.mp4",
      "https://media.example.org:8443/x.mp4",
      "https://user:pass@media.example.org/x.mp4",
      "//evil.example.net/x.mp4",
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      const { result, calls } = await run(() => redirect(location));

      assert.equal(result.status, 502, location);
      assert.equal(calls.length, 1, location);
    }
  });

  it("refuses a redirect without Location, and to a link that cannot be parsed", async () => {
    assert.equal((await run(() => new Response(null, { status: 302 }))).result.status, 502);
    assert.equal((await run(() => redirect("http://[bad"))).result.status, 502);
  });

  it("gives up after 3 redirects", async () => {
    const { result, calls } = await run(() => redirect("/loop.mp4"));

    assert.equal(result.status, 502);
    assert.equal(calls.length, 4);
  });

  it("accepts exactly 3 redirects", async () => {
    const { result, calls } = await run((_call, index) =>
      index < 3 ? redirect(`/hop${index + 1}.mp4`) : video(),
    );

    assert.equal(result.status, 200);
    assert.equal(calls.length, 4);
  });
});

function childTokens(manifest: string): string[] {
  return [...manifest.matchAll(/\/api\/playback\/proxy\/([A-Za-z0-9_-]+)/g)].map(
    (match) => match[1],
  );
}

describe("handleProxyRequest: HLS manifests", () => {
  const MASTER = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x01',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="pt",URI="audio/pt.m3u8"',
    "#EXT-X-STREAM-INF:BANDWIDTH=800000",
    "720/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2000000",
    `${CDN_ORIGIN}/hd/index.m3u8`,
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="iframes.m3u8"',
    "",
  ].join("\n");

  const mpegurl = (body: string, type = "application/vnd.apple.mpegurl") =>
    new Response(body, { headers: { "content-type": type } });

  const token = { upstreamUrl: MASTER_URL, allowedOrigins: [MEDIA_ORIGIN, CDN_ORIGIN] };

  it("rewrites every URI into a proxy token and serves it as a playlist", async () => {
    const { result, calls } = await run(() => mpegurl(MASTER), {}, token);
    const text = await bodyText(result);

    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.match(result.headers["content-type"], /^application\/vnd\.apple\.mpegurl/);
    assert.equal(result.headers["cache-control"], "private, no-store");
    assert.ok(text.startsWith("#EXTM3U\n"));
    assert.equal(childTokens(text).length, 5);
    assert.equal((text.match(/URI="\/api\/playback\/proxy\//g) ?? []).length, 3);
    assert.ok(text.includes("IV=0x01"));
    assert.ok(text.includes('NAME="pt"'));

    for (const line of text.split("\n")) {
      assert.ok(line === "" || line.startsWith("#") || line.startsWith(PROXY_PATH_PREFIX), line);
    }
  });

  it("mints valid child tokens that inherit user, association and origins", async () => {
    const { result } = await run(() => mpegurl(MASTER), {}, { ...token, allowPrivateNetwork: true });
    const children = childTokens(await bodyText(result)).map((value) =>
      readProxyToken(value, { now: NOW, secret: SECRET }),
    );

    assert.equal(children.length, 5);

    const expiresAt = NOW + resolveProxyTtlSeconds() * 1000;

    for (const child of children) {
      assert.ok(child);
      assert.equal(child.userId, USER);
      assert.equal(child.associationId, ASSOCIATION);
      assert.equal(child.allowPrivateNetwork, true);
      assert.deepEqual(child.allowedOrigins, [MEDIA_ORIGIN, CDN_ORIGIN]);
      assert.equal(child.expiresAt, expiresAt);
    }

    assert.deepEqual(
      children.map((child) => child?.upstreamUrl),
      [
        `${MEDIA_ORIGIN}/vod/42/key.bin`,
        `${MEDIA_ORIGIN}/vod/42/audio/pt.m3u8`,
        `${MEDIA_ORIGIN}/vod/42/720/index.m3u8`,
        `${CDN_ORIGIN}/hd/index.m3u8`,
        `${MEDIA_ORIGIN}/vod/42/iframes.m3u8`,
      ],
    );
  });

  it("gives the server-side headers only to children of the origin that owns them", async () => {
    const { result } = await run(() => mpegurl(MASTER), {}, token);
    const children = childTokens(await bodyText(result)).map((value) =>
      readProxyToken(value, { now: NOW, secret: SECRET }),
    );

    for (const child of children) {
      assert.ok(child);

      if (child.upstreamUrl.startsWith(CDN_ORIGIN)) {
        assert.deepEqual(child.headers, {});
      } else {
        assert.deepEqual(child.headers, AUTH_HEADERS);
      }
    }
  });

  it("leaves no upstream URL, host or credential in the rewritten manifest", async () => {
    const { result } = await run(() => mpegurl(MASTER), {}, token);
    const text = await bodyText(result);

    for (const needle of ["hunter2", "api_key", "Bearer", "media.example.org", "cdn.example.org", "https://"]) {
      assert.ok(!text.includes(needle), needle);
    }
  });

  it("a rewritten child can be served in turn (segment => upstream with credentials)", async () => {
    const { result } = await run(() => mpegurl("#EXTM3U\n#EXTINF:6,\nseg0.ts\n"), {}, {
      upstreamUrl: MASTER_URL,
    });
    const [child] = childTokens(await bodyText(result));
    const segment = await run(() => video("segment-bytes"), { token: child });

    assert.equal(segment.result.status, 200);
    assert.equal(segment.calls[0].url, `${MEDIA_ORIGIN}/vod/42/seg0.ts`);
    assert.equal(segment.calls[0].headers.get("authorization"), "Bearer hunter2-token");
    assert.equal(await bodyText(segment.result), "segment-bytes");
  });

  it("detects manifests by content type even without the .m3u8 extension", async () => {
    for (const type of ["application/x-mpegURL", "audio/mpegurl; charset=utf-8"]) {
      const { result } = await run(() => mpegurl("#EXTM3U\nseg.ts\n", type), {}, {
        upstreamUrl: `${MEDIA_ORIGIN}/playlist?id=7`,
      });

      assert.equal(result.status, 200, type);
      assert.equal(childTokens(await bodyText(result)).length, 1, type);
    }
  });

  it("detects manifests by extension even when the content type is generic", async () => {
    const { result } = await run(() => mpegurl("#EXTM3U\nseg.ts\n", "application/octet-stream"), {}, {
      upstreamUrl: MASTER_URL,
    });

    assert.equal(childTokens(await bodyText(result)).length, 1);
  });

  it("refuses the whole manifest when any URI leaves the allowed origins", async () => {
    for (const body of [
      "#EXTM3U\nhttps://evil.example.net/seg.ts\n",
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.example.net/key"\nseg.ts\n',
      "#EXTM3U\nhttp://media.example.org/seg.ts\n",
      "#EXTM3U\nseg.ts\nfile:///etc/passwd\n",
    ]) {
      const { result } = await run(() => mpegurl(body), {}, { upstreamUrl: MASTER_URL });

      assert.equal(result.status, 502, body);
      assert.ok(!(await bodyText(result)).includes("evil"));
    }
  });

  it("refuses something that claims to be a manifest but is not", async () => {
    const { result } = await run(() => mpegurl("<html>login</html>"), {}, {
      upstreamUrl: MASTER_URL,
    });

    assert.equal(result.status, 502);
  });

  it("refuses a manifest whose declared size is over 2 MiB", async () => {
    const { result } = await run(
      () =>
        new Response("#EXTM3U\n", {
          headers: {
            "content-type": "application/vnd.apple.mpegurl",
            "content-length": String(MAX_MANIFEST_BYTES + 1),
          },
        }),
      {},
      { upstreamUrl: MASTER_URL },
    );

    assert.equal(MAX_MANIFEST_BYTES, 2 * 1024 * 1024);
    assert.equal(result.status, 502);
  });

  it("stops reading a streamed manifest at 2 MiB and cancels the upstream", async () => {
    let cancelled = false;
    let sent = 0;
    const chunk = new Uint8Array(256 * 1024).fill(35);
    const { result } = await run(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              sent += chunk.byteLength;
              controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "application/vnd.apple.mpegurl" } },
        ),
      {},
      { upstreamUrl: MASTER_URL },
    );

    assert.equal(result.status, 502);
    assert.equal(cancelled, true);
    assert.ok(sent < MAX_MANIFEST_BYTES + 8 * chunk.byteLength);
  });

  it("accepts a manifest just under the limit", async () => {
    const filler = "#".repeat(1000);
    let body = "#EXTM3U\n";

    while (body.length < MAX_MANIFEST_BYTES - 2000) {
      body += `#${filler}\n`;
    }

    body += "seg.ts\n";

    const { result } = await run(() => mpegurl(body), {}, { upstreamUrl: MASTER_URL });

    assert.equal(result.status, 200);
  });

  it("answers HEAD for a manifest without a body and without rewriting", async () => {
    const { result, calls } = await run(() => mpegurl(""), { method: "HEAD" }, {
      upstreamUrl: MASTER_URL,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body, null);
    assert.equal(calls[0].method, "HEAD");
  });

  it("never asks the upstream for a range of a playlist", async () => {
    const { result, calls } = await run(
      () => mpegurl("#EXTM3U\nseg.ts\n"),
      { rangeHeader: "bytes=10-20", ifRangeHeader: '"x"' },
      { upstreamUrl: MASTER_URL },
    );

    assert.equal(result.status, 200);
    assert.equal(calls[0].headers.get("range"), null);
    assert.equal(calls[0].headers.get("if-range"), null);
  });

  it("refuses a partial (206) playlist", async () => {
    const { result } = await run(
      () => new Response("#EXTM3U\nseg.ts\n", {
        status: 206,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
      {},
      { upstreamUrl: MASTER_URL },
    );

    assert.equal(result.status, 502);
  });

  it("resolves URIs against the URL the playlist came from after a redirect", async () => {
    const { result } = await run(
      (_call, index) =>
        index === 0
          ? new Response(null, { status: 302, headers: { location: "/other/dir/list.m3u8" } })
          : mpegurl("#EXTM3U\nseg.ts\n"),
      {},
      { upstreamUrl: MASTER_URL },
    );
    const [child] = childTokens(await bodyText(result));

    assert.equal(
      readProxyToken(child, { now: NOW, secret: SECRET })?.upstreamUrl,
      `${MEDIA_ORIGIN}/other/dir/seg.ts`,
    );
  });
});

describe("onStreamEnd", () => {
  function source(chunks: number[][], options: { failAfter?: boolean } = {}) {
    const state = { cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new Uint8Array(chunk));
        }

        if (options.failAfter) {
          controller.error(new Error("upstream died"));
        } else {
          controller.close();
        }
      },
      cancel() {
        state.cancelled = true;
      },
    });

    return { stream, state };
  }

  it("passes the bytes through and signals the end exactly once", async () => {
    let ended = 0;
    const { stream } = source([[1, 2], [3]]);
    const text = await new Response(onStreamEnd(stream, () => (ended += 1))).arrayBuffer();

    assert.deepEqual([...new Uint8Array(text)], [1, 2, 3]);
    assert.equal(ended, 1);
  });

  it("signals once when the client cancels, and cancels the upstream", async () => {
    let ended = 0;
    const { stream, state } = source([[1], [2], [3]]);
    const wrapped = onStreamEnd(stream, () => (ended += 1));
    const reader = wrapped.getReader();

    await reader.read();
    await reader.cancel();
    await reader.cancel();

    assert.equal(ended, 1);
    assert.equal(state.cancelled, true);
  });

  it("signals once when the upstream fails", async () => {
    let ended = 0;
    const { stream } = source([[1]], { failAfter: true });
    const wrapped = onStreamEnd(stream, () => (ended += 1));

    await assert.rejects(new Response(wrapped).arrayBuffer());
    assert.equal(ended, 1);
  });
});
