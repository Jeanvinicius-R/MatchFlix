import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilesServerConfig } from "./config";
import { createFilesAdapter, parseFilesAssetId } from "./files.adapter";
import { expectAsset, expectFailure, fakeFetch, signal } from "./test-support";

const BASE = "https://cdn.example.com/media";

const config: FilesServerConfig = {
  id: "acervo",
  label: "Acervo próprio",
  kind: "files",
  baseUrl: BASE,
  auth: { type: "none" },
  proxy: false,
  licenseReference: "Obras de domínio público do acervo",
  allowPrivateNetwork: false,
};

function video(): Response {
  return new Response(null, { status: 200, headers: { "content-type": "video/mp4" } });
}

describe("parseFilesAssetId", () => {
  it("accepts safe relative media paths", () => {
    assert.deepEqual(parseFilesAssetId("movies/bbb/master.m3u8"), {
      path: "movies/bbb/master.m3u8",
      extension: "m3u8",
    });
    assert.deepEqual(parseFilesAssetId("a-b_c.d~e/Film.WEBM"), {
      path: "a-b_c.d~e/Film.WEBM",
      extension: "webm",
    });
    assert.equal(parseFilesAssetId("x.mp4")?.extension, "mp4");
    assert.equal(parseFilesAssetId("dash/manifest.mpd")?.extension, "mpd");
  });

  it("rejects traversal, schemes, absolute paths and odd characters", () => {
    const bad = [
      "",
      "../secret.mp4",
      "a/../b.mp4",
      "a/./b.mp4",
      "a/..b.mp4",
      "/etc/x.mp4",
      "a//b.mp4",
      "https://evil.example.org/x.mp4",
      "//evil.example.org/x.mp4",
      "a\\b.mp4",
      "a/b.mp4?x=1",
      "a/b.mp4#frag",
      "a/%2e%2e/b.mp4",
      "a b/c.mp4",
      "movie.mkv",
      "movie",
      "movie.mp4.exe",
      ".mp4",
      `${"a/".repeat(13)}b.mp4`,
      `${"a".repeat(301)}.mp4`,
    ];

    for (const value of bad) {
      assert.equal(parseFilesAssetId(value), null, JSON.stringify(value));
    }
  });
});

describe("files adapter", () => {
  it("answers a public URL without proxy when there is no auth", async () => {
    const fake = fakeFetch(video);
    const adapter = createFilesAdapter({ config, fetchImpl: fake.impl });
    const asset = expectAsset(await adapter.resolve("movies/bbb/film.mp4", signal()));

    assert.equal(asset.url, `${BASE}/movies/bbb/film.mp4`);
    assert.equal(asset.proxy, undefined);
    assert.equal(asset.type, "direct");
    assert.equal(asset.mimeType, "video/mp4");
    assert.equal(asset.label, "Acervo próprio");
    assert.equal(adapter.licenseReference, "Obras de domínio público do acervo");
    assert.equal(fake.calls.length, 1, "the file is probed");
    assert.equal(fake.calls[0].method, "HEAD");
  });

  it("maps hls and dash to public URLs", async () => {
    const adapter = createFilesAdapter({ config, fetchImpl: fakeFetch(video).impl });
    const hls = expectAsset(await adapter.resolve("a/master.m3u8", signal()));
    const dash = expectAsset(await adapter.resolve("a/manifest.mpd", signal()));

    assert.equal(hls.type, "hls");
    assert.equal(hls.url, `${BASE}/a/master.m3u8`);
    assert.equal(dash.type, "dash");
    assert.equal(dash.url, `${BASE}/a/manifest.mpd`);
  });

  it("uses the proxy when auth is configured (bearer)", async () => {
    const adapter = createFilesAdapter({
      config: { ...config, auth: { type: "bearer", token: "tok" } },
      fetchImpl: fakeFetch(video).impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("a/film.mp4", signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.proxy?.upstreamUrl, `${BASE}/a/film.mp4`);
    assert.deepEqual(asset.proxy?.headers, { Authorization: "Bearer tok" });
    assert.deepEqual(asset.proxy?.allowedOrigins, ["https://cdn.example.com"]);
  });

  it("puts a query auth in the proxied URL and sends the header while probing", async () => {
    const fake = fakeFetch(video);
    const adapter = createFilesAdapter({
      config: { ...config, auth: { type: "header", name: "X-Api-Key", value: "k1" } },
      fetchImpl: fake.impl,
    });
    const asset = expectAsset(await adapter.resolve("a/film.mp4", signal()));

    assert.deepEqual(asset.proxy?.headers, { "X-Api-Key": "k1" });
    assert.equal(fake.calls[0].headers["X-Api-Key"], "k1");

    const query = createFilesAdapter({
      config: { ...config, auth: { type: "query", name: "api_key", value: "k2" } },
      fetchImpl: fakeFetch(video).impl,
      probe: false,
    });
    const queried = expectAsset(await query.resolve("a/film.mp4", signal()));

    assert.equal(queried.proxy?.upstreamUrl, `${BASE}/a/film.mp4?api_key=k2`);
  });

  it("uses the proxy when proxy:true even without auth", async () => {
    const adapter = createFilesAdapter({
      config: { ...config, proxy: true },
      fetchImpl: fakeFetch(video).impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("a/film.mp4", signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.proxy?.headers, undefined);
  });

  it("always proxies a server on a declared private network", async () => {
    const adapter = createFilesAdapter({
      config: { ...config, allowPrivateNetwork: true },
      fetchImpl: fakeFetch(video).impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("a/film.mp4", signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.proxy?.allowPrivateNetwork, true);
    assert.equal(adapter.allowPrivateNetwork, true);
  });

  it("explains that DASH cannot go through the proxy", async () => {
    const adapter = createFilesAdapter({
      config: { ...config, proxy: true },
      fetchImpl: fakeFetch(video).impl,
      probe: false,
    });

    assert.match(
      expectFailure(await adapter.resolve("a/manifest.mpd", signal())),
      /DASH não é suportado através do proxy/,
    );
  });

  it("rejects an unsafe path before any request", async () => {
    const fake = fakeFetch(video);
    const adapter = createFilesAdapter({ config, fetchImpl: fake.impl });

    assert.match(expectFailure(await adapter.resolve("../x.mp4", signal())), /inválido/);
    assert.match(
      expectFailure(await adapter.resolve("https://evil.example.org/x.mp4", signal())),
      /inválido/,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("fails closed when the file does not answer", async () => {
    const fake = fakeFetch(() => new Response("missing", { status: 404 }));
    const adapter = createFilesAdapter({ config, fetchImpl: fake.impl });

    assert.match(expectFailure(await adapter.resolve("a/film.mp4", signal())), /HTTP 404/);
  });

  it("fails closed when the server answers an HTML page", async () => {
    const fake = fakeFetch(
      () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const adapter = createFilesAdapter({ config, fetchImpl: fake.impl });

    assert.match(
      expectFailure(await adapter.resolve("a/film.mp4", signal())),
      /página em vez do vídeo/,
    );
  });

  it("does not follow a redirect to another origin while probing", async () => {
    const fake = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.org/x.mp4" },
        }),
    );
    const adapter = createFilesAdapter({ config, fetchImpl: fake.impl });

    assert.match(
      expectFailure(await adapter.resolve("a/film.mp4", signal())),
      /redirecionou para um destino não permitido/,
    );
    assert.equal(fake.calls.length, 1);
  });

  it("has no discovery or catalog", () => {
    const adapter = createFilesAdapter({ config });

    assert.equal(adapter.discover, undefined);
    assert.equal(adapter.listCatalog, undefined);
  });
});
