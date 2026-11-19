import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryQuery } from "../adapter.types";
import type { XtreamServerConfig } from "./config";
import { PRIVATE_NETWORK_REASON } from "./shared";
import {
  expectAsset,
  expectFailure,
  fakeFetch,
  json,
  paramsOf,
  signal,
  type FakeCall,
} from "./test-support";
import { createXtreamAdapter, parseXtreamAssetId } from "./xtream.adapter";

const BASE = "https://panel.example.com:8443";

const config: XtreamServerConfig = {
  id: "painel",
  label: "Painel do operador",
  kind: "xtream",
  baseUrl: BASE,
  username: "user",
  password: "p@ss/word",
  licenseReference: "Contrato de licenciamento 123/2026",
  allowPrivateNetwork: false,
  mediaOrigins: [],
};

function action(call: FakeCall): string | null {
  return paramsOf(call.url).get("action");
}

const movieQuery: DiscoveryQuery = {
  tmdbId: 603,
  mediaType: "MOVIE",
  seasonNumber: 0,
  episodeNumber: 0,
  title: "Matrix",
  originalTitle: "The Matrix",
  year: 1999,
};

describe("parseXtreamAssetId", () => {
  it("accepts vod and series ids", () => {
    assert.deepEqual(parseXtreamAssetId("vod:1234"), { kind: "vod", vodId: 1234 });
    assert.deepEqual(parseXtreamAssetId("series:55:1:3"), {
      kind: "series",
      seriesId: 55,
      season: 1,
      episode: 3,
    });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "vod:", "vod:abc", "vod:1/../2", "http://evil/x", "series:1:2"]) {
      assert.equal(parseXtreamAssetId(bad), null, bad);
    }
  });
});

describe("xtream adapter: resolve", () => {
  it("answers proxied media with the credentials only in the upstream URL", async () => {
    const fake = fakeFetch(() => json({ movie_data: { stream_id: 77, container_extension: "mp4" } }));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
    const asset = expectAsset(await adapter.resolve("vod:12", signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.type, "direct");
    assert.equal(asset.mimeType, "video/mp4");
    assert.equal(asset.label, "Painel do operador");
    assert.equal(asset.proxy?.upstreamUrl, `${BASE}/movie/user/p%40ss%2Fword/77.mp4`);
    assert.deepEqual(asset.proxy?.allowedOrigins, [BASE]);
    assert.equal(asset.proxy?.allowPrivateNetwork, undefined);

    assert.equal(fake.calls.length, 1);
    assert.equal(action(fake.calls[0]), "get_vod_info");
    assert.equal(paramsOf(fake.calls[0].url).get("vod_id"), "12");
    assert.equal(paramsOf(fake.calls[0].url).get("password"), "p@ss/word");
  });

  it("maps m3u8 to hls and exposes the license reference", async () => {
    const fake = fakeFetch(() => json({ movie_data: { stream_id: 5, container_extension: "m3u8" } }));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
    const asset = expectAsset(await adapter.resolve("vod:5", signal()));

    assert.equal(asset.type, "hls");
    assert.equal(asset.proxy?.upstreamUrl, `${BASE}/movie/user/p%40ss%2Fword/5.m3u8`);
    assert.equal(adapter.id, "painel");
    assert.equal(adapter.licenseReference, "Contrato de licenciamento 123/2026");
  });

  it("refuses formats the browser cannot play", async () => {
    for (const extension of ["mkv", "avi", "ts"]) {
      const fake = fakeFetch(() =>
        json({ movie_data: { stream_id: 5, container_extension: extension } }),
      );
      const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
      const reason = expectFailure(await adapter.resolve("vod:5", signal()));

      assert.match(reason, /não suportado pelo navegador/, extension);
      assert.ok(!reason.includes("p@ss"), "no credentials in the reason");
    }
  });

  it("refuses when the panel does not say the format", async () => {
    const fake = fakeFetch(() => json({ movie_data: { stream_id: 5 } }));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(expectFailure(await adapter.resolve("vod:5", signal())), /formato/);
  });

  it("validates the asset id before any request", async () => {
    const fake = fakeFetch(() => json({}));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(expectFailure(await adapter.resolve("../etc/passwd", signal())), /inválido/);
    assert.equal(fake.calls.length, 0);
  });

  it("resolves an episode through get_series_info", async () => {
    const fake = fakeFetch(() =>
      json({
        episodes: {
          "1": [
            { id: "500", episode_num: 2, season: 1, container_extension: "mp4" },
            { id: "501", episode_num: 3, season: 1, container_extension: "mp4" },
          ],
        },
      }),
    );
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
    const asset = expectAsset(await adapter.resolve("series:55:1:3", signal()));

    assert.equal(action(fake.calls[0]), "get_series_info");
    assert.equal(asset.proxy?.upstreamUrl, `${BASE}/series/user/p%40ss%2Fword/501.mp4`);
  });

  it("fails closed when the episode is missing", async () => {
    const fake = fakeFetch(() => json({ episodes: { "1": [] } }));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(
      expectFailure(await adapter.resolve("series:55:1:3", signal())),
      /Episódio não encontrado/,
    );
  });

  it("turns panel errors into a reason without credentials", async () => {
    const fake = fakeFetch(() => new Response("boom", { status: 500 }));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
    const reason = expectFailure(await adapter.resolve("vod:1", signal()));

    assert.match(reason, /HTTP 500/);
    assert.ok(!reason.includes("p@ss") && !reason.includes("user"));
  });

  it("does not follow a redirect to another host", async () => {
    const fake = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.org/steal" },
        }),
    );
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(
      expectFailure(await adapter.resolve("vod:1", signal())),
      /redirecionou para um destino não permitido/,
    );
    assert.equal(fake.calls.length, 1);
  });

  it("explains a refusal of a private address", async () => {
    const impl = (async () => {
      throw new Error("Destino recusado: endereço de rede privado ou reservado.");
    }) as typeof fetch;
    const adapter = createXtreamAdapter({ config, fetchImpl: impl, probe: false });

    assert.equal(expectFailure(await adapter.resolve("vod:1", signal())), PRIVATE_NETWORK_REASON);
  });

  it("carries allowPrivateNetwork into the proxy description", async () => {
    const fake = fakeFetch(() => json({ movie_data: { stream_id: 5, container_extension: "mp4" } }));
    const adapter = createXtreamAdapter({
      config: { ...config, allowPrivateNetwork: true },
      fetchImpl: fake.impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("vod:5", signal()));

    assert.equal(asset.proxy?.allowPrivateNetwork, true);
  });

  it("probes the video before answering", async () => {
    const fake = fakeFetch((call) =>
      call.url.includes("player_api.php")
        ? json({ movie_data: { stream_id: 9, container_extension: "mp4" } })
        : new Response(null, { status: 200, headers: { "content-type": "video/mp4" } }),
    );
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl });
    const asset = expectAsset(await adapter.resolve("vod:9", signal()));

    assert.equal(asset.type, "direct");
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].method, "HEAD");
    assert.ok(fake.calls[1].url.endsWith("/9.mp4"));
  });

  it("fails when the video file does not answer", async () => {
    const fake = fakeFetch((call) =>
      call.url.includes("player_api.php")
        ? json({ movie_data: { stream_id: 9, container_extension: "mp4" } })
        : new Response("nope", { status: 404 }),
    );
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl });
    const reason = expectFailure(await adapter.resolve("vod:9", signal()));

    assert.match(reason, /HTTP 404/);
    assert.ok(!reason.includes("p%40ss") && !reason.includes("p@ss"));
  });

  it("adds the operator's media origins to what the proxy may contact", async () => {
    const fake = fakeFetch(() => json({ movie_data: { stream_id: 5, container_extension: "mp4" } }));
    const adapter = createXtreamAdapter({
      config: { ...config, mediaOrigins: ["https://cdn.example.com"] },
      fetchImpl: fake.impl,
      probe: false,
    });
    const asset = expectAsset(await adapter.resolve("vod:5", signal()));

    assert.deepEqual(asset.proxy?.allowedOrigins, [BASE, "https://cdn.example.com"]);
  });
});

describe("xtream adapter: catalog and discovery", () => {
  const vodList = [
    { stream_id: 1, name: "Matrix (1999)", tmdb: "603" },
    { stream_id: 2, name: "[PT-BR] Matrix", year: "1999", tmdb: "0" },
    { stream_id: 3, name: "Matrix", tmdb: "9999" },
    { stream_id: 4, name: "Outro Filme (2005)" },
    { stream_id: "x", name: "Sem id valido" },
  ];

  function vodAdapter(now?: () => number) {
    const fake = fakeFetch((call) => {
      if (action(call) === "get_vod_streams") {
        return json(vodList);
      }

      return json({}, 404);
    });

    return {
      fake,
      adapter: createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false, now }),
    };
  }

  it("lists the catalog with declared TMDB ids only when numeric", async () => {
    const { adapter } = vodAdapter();
    const page = await adapter.listCatalog?.(undefined, signal());

    assert.ok(page && !("reason" in page));
    assert.equal(page.nextCursor, undefined);
    assert.deepEqual(
      page.items.map((item) => [item.providerAssetId, item.title, item.year, item.externalIds]),
      [
        ["vod:1", "Matrix", 1999, { tmdb: 603 }],
        ["vod:2", "Matrix", 1999, undefined],
        ["vod:3", "Matrix", undefined, { tmdb: 9999 }],
        ["vod:4", "Outro Filme", 2005, undefined],
      ],
    );
    assert.ok(page.items.every((item) => item.mediaType === "MOVIE"));
  });

  it("pages the catalog by offset", async () => {
    const many = Array.from({ length: 250 }, (_, index) => ({
      stream_id: index + 1,
      name: `Filme ${index + 1}`,
    }));
    const fake = fakeFetch(() => json(many));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
    const first = await adapter.listCatalog?.(undefined, signal());

    assert.ok(first && !("reason" in first));
    assert.equal(first.items.length, 200);
    assert.equal(first.nextCursor, "200");

    const second = await adapter.listCatalog?.("200", signal());

    assert.ok(second && !("reason" in second));
    assert.equal(second.items.length, 50);
    assert.equal(second.nextCursor, undefined);
    assert.equal(fake.calls.length, 1, "the list is cached");

    assert.match(
      expectFailure(await adapter.listCatalog?.("-1", signal())),
      /Cursor do catálogo inválido/,
    );
  });

  it("discovers by declared TMDB id first, then by title and year", async () => {
    const { adapter } = vodAdapter();
    const found = await adapter.discover?.(movieQuery, signal());

    assert.ok(found && !("reason" in found));
    // vod:3 declares ANOTHER tmdb id, so it is ruled out; vod:4 is another title.
    assert.deepEqual(
      found.map((candidate) => candidate.providerAssetId),
      ["vod:1", "vod:2"],
    );
    assert.deepEqual(found[0].externalIds, { tmdb: 603 });
  });

  it("caches the catalog for ten minutes", async () => {
    let clock = 0;
    const { adapter, fake } = vodAdapter(() => clock);

    await adapter.discover?.(movieQuery, signal());
    await adapter.discover?.(movieQuery, signal());
    assert.equal(fake.calls.length, 1);

    clock += 10 * 60 * 1000 + 1;
    await adapter.discover?.(movieQuery, signal());
    assert.equal(fake.calls.length, 2);
  });

  it("does not cache a failed download", async () => {
    let healthy = false;
    const fake = fakeFetch(() => (healthy ? json(vodList) : new Response("x", { status: 503 })));
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });

    assert.match(expectFailure(await adapter.discover?.(movieQuery, signal())), /HTTP 503/);
    healthy = true;

    const found = await adapter.discover?.(movieQuery, signal());

    assert.ok(found && !("reason" in found));
    assert.equal(found.length, 2);
  });

  it("discovers an episode through get_series and get_series_info", async () => {
    const fake = fakeFetch((call) => {
      switch (action(call)) {
        case "get_series":
          return json([
            { series_id: 55, name: "Breaking Bad (2008)", tmdb: "1396" },
            { series_id: 56, name: "Outra Serie" },
          ]);
        case "get_series_info":
          return json({
            episodes: { "1": [{ id: "501", episode_num: "3", season: 1, container_extension: "mp4" }] },
          });
        default:
          return json({}, 404);
      }
    });
    const adapter = createXtreamAdapter({ config, fetchImpl: fake.impl, probe: false });
    const found = await adapter.discover?.(
      {
        tmdbId: 1396,
        mediaType: "EPISODE",
        seasonNumber: 1,
        episodeNumber: 3,
        title: "Breaking Bad",
      },
      signal(),
    );

    assert.ok(found && !("reason" in found));
    assert.equal(found.length, 1);
    assert.equal(found[0].providerAssetId, "series:55:1:3");
    assert.equal(found[0].title, "Breaking Bad S01E03");
    assert.deepEqual(found[0].externalIds, { tmdb: 1396 });
    assert.equal(
      fake.calls.filter((call) => action(call) === "get_series_info").length,
      1,
      "only the matching series is queried",
    );
  });
});
