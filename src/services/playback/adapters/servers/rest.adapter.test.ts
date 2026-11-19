import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryQuery } from "../adapter.types";
import type { RestServerConfig } from "./config";
import { createRestAdapter, isValidRestAssetId } from "./rest.adapter";
import { PRIVATE_NETWORK_REASON } from "./shared";
import { expectAsset, expectFailure, fakeFetch, json, signal } from "./test-support";

const API = "https://api.example.com";

const config: RestServerConfig = {
  id: "api-acervo",
  label: "API do acervo",
  kind: "rest",
  baseUrl: API,
  auth: { type: "bearer", token: "tok-secret" },
  assetPath: "/v1/videos/{assetId}",
  urlPath: "playback.url",
  typePath: "playback.type",
  mediaNeedsAuth: false,
  mediaOrigins: [],
  searchPath: "/v1/search?tmdb={tmdbId}&imdb={imdbId}&q={title}&year={year}",
  itemsPath: "results",
  idPath: "id",
  titlePath: "title",
  yearPath: "year",
  tmdbPath: "ids.tmdb",
  imdbPath: "ids.imdb",
  licenseReference: "Contrato de distribuição 55/2026",
  allowPrivateNetwork: false,
};

function playback(url: string, type?: string) {
  return { playback: type === undefined ? { url } : { url, type } };
}

describe("isValidRestAssetId", () => {
  it("accepts provider ids and rejects anything that could shape the URL", () => {
    for (const ok of ["abc-1", "a:b", "A_b.c~d", "12345"]) {
      assert.equal(isValidRestAssetId(ok), true, ok);
    }

    for (const bad of ["", ".", "..", "a/b", "a..b", "a b", "a?b", "a#b", "a%2e", "x".repeat(201)]) {
      assert.equal(isValidRestAssetId(bad), false, bad);
    }
  });
});

describe("rest adapter: resolve", () => {
  it("reads the media URL by dot-path and sends the auth to the API", async () => {
    const fake = fakeFetch(() => json(playback(`${API}/media/v1.mp4`, "mp4")));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });
    const asset = expectAsset(await adapter.resolve("abc-1", signal()));

    assert.equal(asset.url, `${API}/media/v1.mp4`);
    assert.equal(asset.proxy, undefined);
    assert.equal(asset.type, "direct");
    assert.equal(asset.mimeType, "video/mp4");
    assert.equal(fake.calls[0].url, `${API}/v1/videos/abc-1`);
    assert.equal(fake.calls[0].headers.Authorization, "Bearer tok-secret");
    assert.equal(adapter.licenseReference, "Contrato de distribuição 55/2026");
  });

  it("encodes the asset id and keeps the request on the server", async () => {
    const fake = fakeFetch(() => json(playback(`${API}/media/v1.mp4`)));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    expectAsset(await adapter.resolve("a:b", signal()));
    assert.equal(fake.calls[0].url, `${API}/v1/videos/a%3Ab`);
  });

  it("rejects unsafe ids before any request", async () => {
    const fake = fakeFetch(() => json({}));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    for (const bad of ["../x", "a/b", "..", ".", "a b", "", "https://evil.example.org"]) {
      assert.match(expectFailure(await adapter.resolve(bad, signal())), /inválido/, bad);
    }

    assert.equal(fake.calls.length, 0);
  });

  it("uses the declared type when the URL has no extension", async () => {
    const fake = fakeFetch(() => json(playback(`${API}/stream/abc`, "HLS")));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });
    const asset = expectAsset(await adapter.resolve("abc", signal()));

    assert.equal(asset.type, "hls");
    assert.equal(asset.mimeType, "application/vnd.apple.mpegurl");
  });

  it("refuses an unknown format", async () => {
    const fake = fakeFetch(() => json(playback(`${API}/stream/abc`)));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(expectFailure(await adapter.resolve("abc", signal())), /não suportado/);

    const mkv = fakeFetch(() => json(playback(`${API}/stream/abc.mkv`, "mkv")));
    const other = createRestAdapter({ config, fetchImpl: mkv.impl, probe: false });

    assert.match(expectFailure(await other.resolve("abc", signal())), /não suportado/);
  });

  it("requires an https URL in the answer", async () => {
    const fake = fakeFetch(() => json(playback("http://api.example.com/media/v1.mp4")));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(expectFailure(await adapter.resolve("abc", signal())), /não é https/);

    const userinfo = fakeFetch(() => json(playback("https://u:p@api.example.com/v.mp4")));
    const other = createRestAdapter({ config, fetchImpl: userinfo.impl, probe: false });

    assert.match(expectFailure(await other.resolve("abc", signal())), /não é https/);
  });

  it("fails when the answer has no URL at the path", async () => {
    const fake = fakeFetch(() => json({ playback: {} }));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(expectFailure(await adapter.resolve("abc", signal())), /não informou a URL/);
  });

  it("refuses a media URL on an origin nobody allowed", async () => {
    const fake = fakeFetch(() => json(playback("https://evil.example.org/v.mp4")));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(
      expectFailure(await adapter.resolve("abc", signal())),
      /fora das origens permitidas/,
    );
  });

  it("accepts a media origin the operator listed", async () => {
    const fake = fakeFetch(() => json(playback("https://cdn.example.com/v.mp4")));
    const adapter = createRestAdapter({
      config: { ...config, mediaOrigins: ["https://cdn.example.com"] },
      fetchImpl: fake.impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("abc", signal()));

    assert.equal(asset.url, "https://cdn.example.com/v.mp4");
  });

  it("proxies with the same credentials when media needs auth", async () => {
    const fake = fakeFetch(() => json(playback(`${API}/media/v1.mp4`)));
    const adapter = createRestAdapter({
      config: { ...config, mediaNeedsAuth: true },
      fetchImpl: fake.impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("abc", signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.proxy?.upstreamUrl, `${API}/media/v1.mp4`);
    assert.deepEqual(asset.proxy?.headers, { Authorization: "Bearer tok-secret" });
    assert.deepEqual(asset.proxy?.allowedOrigins, [API]);
  });

  it("proxies a query-authenticated mp4 but not HLS", async () => {
    const queryConfig: RestServerConfig = {
      ...config,
      auth: { type: "query", name: "api_key", value: "k9" },
      mediaNeedsAuth: true,
    };
    const mp4 = createRestAdapter({
      config: queryConfig,
      fetchImpl: fakeFetch(() => json(playback(`${API}/m/v1.mp4`))).impl,
      probe: false,
    });
    const hls = createRestAdapter({
      config: queryConfig,
      fetchImpl: fakeFetch(() => json(playback(`${API}/m/v1.m3u8`))).impl,
      probe: false,
    });

    assert.equal(
      expectAsset(await mp4.resolve("abc", signal())).proxy?.upstreamUrl,
      `${API}/m/v1.mp4?api_key=k9`,
    );
    assert.match(expectFailure(await hls.resolve("abc", signal())), /HLS com autenticação/);
  });

  it("always proxies a server on a declared private network", async () => {
    const fake = fakeFetch(() => json(playback(`${API}/media/v1.mp4`)));
    const adapter = createRestAdapter({
      config: { ...config, allowPrivateNetwork: true },
      fetchImpl: fake.impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("abc", signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.proxy?.allowPrivateNetwork, true);
    // The media is public-style (no auth), so the proxy sends no credentials.
    assert.equal(asset.proxy?.headers, undefined);
  });

  it("probes the media before answering", async () => {
    const fake = fakeFetch((call) =>
      call.url.includes("/v1/videos/")
        ? json(playback(`${API}/media/v1.mp4`))
        : new Response("gone", { status: 404 }),
    );
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl });

    assert.match(expectFailure(await adapter.resolve("abc", signal())), /HTTP 404/);
  });

  it("hides credentials in failures", async () => {
    const fake = fakeFetch(() => new Response("no", { status: 401 }));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });
    const reason = expectFailure(await adapter.resolve("abc", signal()));

    assert.match(reason, /HTTP 401/);
    assert.ok(!reason.includes("tok-secret"));
  });

  it("explains a refusal of a private address", async () => {
    const impl = (async () => {
      throw new Error("Destino recusado: endereço de rede privado ou reservado.");
    }) as typeof fetch;
    const adapter = createRestAdapter({ config, fetchImpl: impl, probe: false });

    assert.equal(expectFailure(await adapter.resolve("abc", signal())), PRIVATE_NETWORK_REASON);
  });
});

describe("rest adapter: discover", () => {
  const query: DiscoveryQuery = {
    tmdbId: 603,
    imdbId: "tt0133093",
    mediaType: "MOVIE",
    seasonNumber: 0,
    episodeNumber: 0,
    title: "Matrix",
    year: 1999,
  };

  const results = {
    results: [
      { id: "10", title: "Matrix", year: 1999, ids: { tmdb: 603, imdb: "tt0133093" } },
      { id: "11", title: "Matrix", year: 1999, ids: { tmdb: 604 } },
      { id: "12", title: "Matrix", year: "1999", ids: {} },
      { id: "bad id", title: "Matrix" },
      { id: 13, title: "Outro", ids: { imdb: "tt0000001" } },
      { id: "14", title: "Matrix", ids: { imdb: "tt0000002" } },
    ],
  };

  it("builds the search URL from the templates (encoded) and filters the answer", async () => {
    const fake = fakeFetch(() => json(results));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });
    const found = await adapter.discover?.(query, signal());

    assert.equal(
      fake.calls[0].url,
      `${API}/v1/search?tmdb=603&imdb=tt0133093&q=Matrix&year=1999`,
    );
    assert.equal(fake.calls[0].headers.Authorization, "Bearer tok-secret");
    assert.ok(found && !("reason" in found));
    // 11 and 14 declare ANOTHER title's ids; "bad id" is not a valid id; 13 is another title.
    assert.deepEqual(found, [
      { providerAssetId: "10", title: "Matrix", year: 1999, externalIds: { tmdb: 603, imdb: "tt0133093" } },
      { providerAssetId: "12", title: "Matrix", year: 1999 },
    ]);
  });

  it("encodes the title", async () => {
    const fake = fakeFetch(() => json({ results: [] }));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    await adapter.discover?.(
      { ...query, imdbId: undefined, year: undefined, title: "O Poderoso Chefão & Cia/?" },
      signal(),
    );

    assert.equal(
      fake.calls[0].url,
      `${API}/v1/search?tmdb=603&imdb=&q=O%20Poderoso%20Chef%C3%A3o%20%26%20Cia%2F%3F&year=`,
    );
  });

  it("accepts a root array when itemsPath is not set", async () => {
    const fake = fakeFetch(() => json(results.results));
    const adapter = createRestAdapter({
      config: { ...config, itemsPath: undefined },
      fetchImpl: fake.impl,
      probe: false,
    });
    const found = await adapter.discover?.(query, signal());

    assert.ok(found && !("reason" in found));
    assert.equal(found.length, 2);
  });

  it("fails closed on an unexpected answer", async () => {
    const fake = fakeFetch(() => json({ results: "nope" }));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(
      expectFailure(await adapter.discover?.(query, signal())),
      /formato inesperado/,
    );
  });

  it("does not search episodes", async () => {
    const fake = fakeFetch(() => json(results));
    const adapter = createRestAdapter({ config, fetchImpl: fake.impl, probe: false });
    const found = await adapter.discover?.({ ...query, mediaType: "EPISODE" }, signal());

    assert.deepEqual(found, []);
    assert.equal(fake.calls.length, 0);
  });

  it("is absent without a searchPath", () => {
    const adapter = createRestAdapter({ config: { ...config, searchPath: undefined } });

    assert.equal(adapter.discover, undefined);
    assert.equal(adapter.listCatalog, undefined);
  });
});
