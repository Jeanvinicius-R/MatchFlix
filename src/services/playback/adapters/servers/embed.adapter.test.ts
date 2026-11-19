import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmbedServerConfig } from "./config";
import { parsePlaybackServers } from "./config";
import {
  buildEmbedUrl,
  createEmbedAdapter,
  describeFramingProblem,
  formatEmbedAssetId,
  parseEmbedAssetId,
} from "./embed.adapter";
import { expectAsset, expectFailure, fakeFetch, signal } from "./test-support";

const BASE = "https://player.example.com";

function makeConfig(overrides: Partial<EmbedServerConfig> = {}): EmbedServerConfig {
  return {
    id: "player-externo",
    label: "Player Externo",
    kind: "embed",
    enabled: true,
    baseUrl: BASE,
    identifierType: "tmdb",
    movieTemplate: "/embed/movie/{tmdbId}",
    episodeTemplate: "/embed/tv/{tmdbId}/{season}/{episode}",
    sandbox: true,
    licenseReference: "Contrato 123/2026 com o distribuidor X",
    allowPrivateNetwork: false,
    ...overrides,
  };
}

function page(headers: Record<string, string> = {}, status = 200): Response {
  return new Response("<html></html>", {
    status,
    headers: { "content-type": "text/html", ...headers },
  });
}

describe("parseEmbedAssetId / formatEmbedAssetId", () => {
  it("parses TMDB movie and episode ids", () => {
    assert.deepEqual(parseEmbedAssetId("550", "tmdb"), { id: "550" });
    assert.deepEqual(parseEmbedAssetId("1399/1/1", "tmdb"), { id: "1399", season: 1, episode: 1 });
    assert.deepEqual(parseEmbedAssetId("1399/0/3", "tmdb"), { id: "1399", season: 0, episode: 3 });
  });

  it("parses IMDb ids and provider slugs", () => {
    assert.deepEqual(parseEmbedAssetId("tt0137523", "imdb"), { id: "tt0137523" });
    assert.deepEqual(parseEmbedAssetId("tt0944947/2/5", "imdb"), {
      id: "tt0944947",
      season: 2,
      episode: 5,
    });
    assert.deepEqual(parseEmbedAssetId("BigBuckBunny_124", "asset"), { id: "BigBuckBunny_124" });
  });

  it("rejects ids of the wrong kind, traversal, schemes and odd numbers", () => {
    const bad: Array<[string, "tmdb" | "imdb" | "asset"]> = [
      ["", "tmdb"],
      ["0", "tmdb"],
      ["-5", "tmdb"],
      ["12a", "tmdb"],
      ["1234567890", "tmdb"],
      ["550/", "tmdb"],
      ["550/1", "tmdb"],
      ["550/1/0", "tmdb"],
      ["550/1/1/1", "tmdb"],
      ["550/x/1", "tmdb"],
      ["550/1000/1", "tmdb"],
      ["550?x=1", "tmdb"],
      ["tt123", "imdb"],
      ["550", "imdb"],
      ["tt0137523", "tmdb"],
      ["../etc", "asset"],
      ["..", "asset"],
      ["https://evil.example.org", "asset"],
      ["a b", "asset"],
      ["a%2Fb", "asset"],
      ["-start", "asset"],
    ];

    for (const [raw, type] of bad) {
      assert.equal(parseEmbedAssetId(raw, type), null, `${type}:${raw}`);
    }
  });

  it("round-trips", () => {
    assert.equal(formatEmbedAssetId({ id: "550" }), "550");
    assert.equal(formatEmbedAssetId({ id: "1399", season: 1, episode: 2 }), "1399/1/2");
  });
});

describe("buildEmbedUrl", () => {
  it("builds the movie URL from the TMDB id", () => {
    assert.equal(buildEmbedUrl(makeConfig(), { id: "550" }), `${BASE}/embed/movie/550`);
  });

  it("builds the episode URL from series + season + episode", () => {
    assert.equal(
      buildEmbedUrl(makeConfig(), { id: "1399", season: 1, episode: 1 }),
      `${BASE}/embed/tv/1399/1/1`,
    );
  });

  it("supports query-string templates and the {id} alias", () => {
    const config = makeConfig({
      movieTemplate: "/embed?video_id={id}&tmdb=1",
      episodeTemplate: "/embed?video_id={id}&s={season}&e={episode}&tmdb=1",
    });

    assert.equal(buildEmbedUrl(config, { id: "550" }), `${BASE}/embed?video_id=550&tmdb=1`);
    assert.equal(
      buildEmbedUrl(config, { id: "1399", season: 2, episode: 3 }),
      `${BASE}/embed?video_id=1399&s=2&e=3&tmdb=1`,
    );
  });

  it("uses the IMDb id for imdb providers", () => {
    const config = makeConfig({
      identifierType: "imdb",
      movieTemplate: "/filme/{imdbId}",
      episodeTemplate: "/serie/{imdbId}/{season}/{episode}",
    });

    assert.equal(buildEmbedUrl(config, { id: "tt0137523" }), `${BASE}/filme/tt0137523`);
    assert.equal(
      buildEmbedUrl(config, { id: "tt0944947", season: 1, episode: 1 }),
      `${BASE}/serie/tt0944947/1/1`,
    );
  });

  it("refuses an episode when the provider has no episode template", () => {
    const failure = expectFailure(
      buildEmbedUrl(makeConfig({ episodeTemplate: undefined }), { id: "1", season: 1, episode: 1 }),
    );

    assert.match(failure, /epis[óo]dios/i);
  });

  it("refuses an id that does not fit the identifier type (no URL is formed)", () => {
    assert.match(expectFailure(buildEmbedUrl(makeConfig(), { id: "tt0137523" })), /inv[áa]lido/i);
    assert.match(expectFailure(buildEmbedUrl(makeConfig(), { id: "5/../x" })), /inv[áa]lido/i);
  });
});

describe("describeFramingProblem", () => {
  it("flags X-Frame-Options DENY / SAMEORIGIN", () => {
    assert.ok(describeFramingProblem(new Headers({ "x-frame-options": "DENY" })));
    assert.ok(describeFramingProblem(new Headers({ "x-frame-options": "sameorigin" })));
  });

  it("flags frame-ancestors that only allow nobody / itself", () => {
    assert.ok(
      describeFramingProblem(new Headers({ "content-security-policy": "frame-ancestors 'none'" })),
    );
    assert.ok(
      describeFramingProblem(
        new Headers({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'" }),
      ),
    );
  });

  it("accepts open or origin-listing policies and no policy", () => {
    assert.equal(describeFramingProblem(new Headers()), null);
    assert.equal(
      describeFramingProblem(new Headers({ "content-security-policy": "frame-ancestors *" })),
      null,
    );
    assert.equal(
      describeFramingProblem(
        new Headers({ "content-security-policy": "frame-ancestors https://matchflix.example" }),
      ),
      null,
    );
  });
});

describe("createEmbedAdapter.resolve", () => {
  it("returns a sandboxed iframe, marked unconfirmed, without touching the network when playing", async () => {
    const { impl, calls } = fakeFetch(() => page());
    const adapter = createEmbedAdapter({ config: makeConfig(), fetchImpl: impl });
    const asset = expectAsset(await adapter.resolve("550", signal()));

    assert.equal(asset.type, "iframe");
    assert.equal(asset.url, `${BASE}/embed/movie/550`);
    assert.equal(asset.sandbox, true);
    assert.equal(asset.unconfirmed, true);
    assert.equal(calls.length, 0);
  });

  it("builds the episode URL", async () => {
    const adapter = createEmbedAdapter({ config: makeConfig(), fetchImpl: fakeFetch(() => page()).impl });
    const asset = expectAsset(await adapter.resolve("1399/1/1", signal()));

    assert.equal(asset.url, `${BASE}/embed/tv/1399/1/1`);
  });

  it("is switched off when disabled", async () => {
    const adapter = createEmbedAdapter({
      config: makeConfig({ enabled: false }),
      fetchImpl: fakeFetch(() => page()).impl,
    });

    assert.match(expectFailure(await adapter.resolve("550", signal())), /desativado/i);
    assert.equal(adapter.descriptor?.enabled, false);
  });

  it("refuses malformed asset ids", async () => {
    const adapter = createEmbedAdapter({ config: makeConfig(), fetchImpl: fakeFetch(() => page()).impl });

    for (const bad of ["", "abc", "550/1", "../1", "https://evil.example.org/x"]) {
      assert.match(expectFailure(await adapter.resolve(bad, signal())), /inv[áa]lido/i, bad);
    }
  });

  it("on a verify check requests the page and accepts a frameable 200", async () => {
    const { impl, calls } = fakeFetch(() => page());
    const adapter = createEmbedAdapter({ config: makeConfig(), fetchImpl: impl });
    const asset = expectAsset(await adapter.resolve("550", { ...signal(), purpose: "verify" }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/embed/movie/550`);
    assert.equal(asset.unconfirmed, true);
  });

  it("on a verify check refuses 404, 5xx, frame-blocking headers and off-origin redirects", async () => {
    const cases: Array<[() => Response, RegExp]> = [
      [() => page({}, 404), /n[ãa]o tem p[áa]gina/i],
      [() => page({}, 503), /HTTP 503/],
      [() => page({ "x-frame-options": "DENY" }), /incorporar/i],
      [
        () => new Response(null, { status: 302, headers: { location: "https://evil.example.org/x" } }),
        /fora do dom[íi]nio/i,
      ],
    ];

    for (const [makeResponse, pattern] of cases) {
      const adapter = createEmbedAdapter({
        config: makeConfig(),
        fetchImpl: fakeFetch(() => makeResponse()).impl,
      });

      assert.match(
        expectFailure(await adapter.resolve("550", { ...signal(), purpose: "verify" })),
        pattern,
      );
    }
  });

  it("follows a redirect that stays on the authorized origin", async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.url.endsWith("/embed/movie/550")
        ? new Response(null, { status: 301, headers: { location: "/embed/movie/550/" } })
        : page(),
    );
    const adapter = createEmbedAdapter({ config: makeConfig(), fetchImpl: impl });

    expectAsset(await adapter.resolve("550", { ...signal(), purpose: "verify" }));
    assert.equal(calls.length, 2);
  });

  it("reports a network failure as a reason, never throws", async () => {
    const adapter = createEmbedAdapter({
      config: makeConfig(),
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof fetch,
    });

    assert.match(
      expectFailure(await adapter.resolve("550", { ...signal(), purpose: "verify" })),
      /falha de rede/i,
    );
  });
});

describe("createEmbedAdapter.deriveAssetId", () => {
  const movie = { tmdbId: 550, mediaType: "MOVIE" as const, seasonNumber: 0, episodeNumber: 0 };
  const episode = { tmdbId: 1399, mediaType: "EPISODE" as const, seasonNumber: 1, episodeNumber: 1 };

  it("derives the TMDB id for tmdb providers (movie and episode)", () => {
    const adapter = createEmbedAdapter({ config: makeConfig() });

    assert.equal(adapter.requiresImdbId, false);
    assert.equal(adapter.deriveAssetId?.(movie), "550");
    assert.equal(adapter.deriveAssetId?.(episode), "1399/1/1");
  });

  it("needs the IMDb id from TMDB for imdb providers and fails closed without it", () => {
    const adapter = createEmbedAdapter({
      config: makeConfig({
        identifierType: "imdb",
        movieTemplate: "/filme/{imdbId}",
        episodeTemplate: "/serie/{imdbId}/{season}/{episode}",
      }),
    });

    assert.equal(adapter.requiresImdbId, true);
    assert.equal(adapter.deriveAssetId?.({ ...movie, imdbId: "tt0137523" }), "tt0137523");
    assert.equal(adapter.deriveAssetId?.({ ...episode, imdbId: "tt0944947" }), "tt0944947/1/1");
    assert.match(expectFailure(adapter.deriveAssetId?.(movie)), /IMDb/);
    assert.match(expectFailure(adapter.deriveAssetId?.({ ...movie, imdbId: "not-an-id" })), /IMDb/);
  });

  it("never guesses ids for providers with their own ids", () => {
    const adapter = createEmbedAdapter({ config: makeConfig({ identifierType: "asset", movieTemplate: "/embed/{id}" }) });

    assert.match(expectFailure(adapter.deriveAssetId?.(movie)), /pr[óo]prios/);
  });
});

describe("PLAYBACK_SERVERS: kind embed", () => {
  const base = {
    id: "player-externo",
    label: "Player Externo",
    kind: "embed",
    baseUrl: BASE,
    identifierType: "tmdb",
    movieTemplate: "/embed/movie/{tmdbId}",
    episodeTemplate: "/embed/tv/{tmdbId}/{season}/{episode}",
    licenseReference: "Contrato 123/2026 com o distribuidor X",
  };

  function parse(item: Record<string, unknown>): { servers: ReturnType<typeof parsePlaybackServers>; warnings: string[] } {
    const warnings: string[] = [];

    return {
      servers: parsePlaybackServers(JSON.stringify([item]), { env: {}, warn: (m) => warnings.push(m) }),
      warnings,
    };
  }

  it("accepts a valid embed server (enabled and sandboxed by default)", () => {
    const { servers } = parse(base);

    assert.equal(servers.length, 1);
    assert.equal(servers[0].kind, "embed");
    assert.equal((servers[0] as EmbedServerConfig).enabled, true);
    assert.equal((servers[0] as EmbedServerConfig).sandbox, true);
  });

  it("honors enabled:false and sandbox:false", () => {
    const [server] = parse({ ...base, enabled: false, sandbox: false }).servers as EmbedServerConfig[];

    assert.equal(server.enabled, false);
    assert.equal(server.sandbox, false);
  });

  it("requires licenseReference", () => {
    const { licenseReference, ...withoutLicense } = base;

    void licenseReference;
    assert.equal(parse(withoutLicense).servers.length, 0);
  });

  it("refuses http, paths in baseUrl, credentials and non-origin values", () => {
    for (const baseUrl of [
      "http://player.example.com",
      "https://player.example.com/embed",
      "https://user:pass@player.example.com",
      "javascript:alert(1)",
      "//player.example.com",
    ]) {
      assert.equal(parse({ ...base, baseUrl }).servers.length, 0, baseUrl);
    }
  });

  it("refuses templates that could change the host or escape the path", () => {
    for (const movieTemplate of [
      "//evil.example.org/{tmdbId}",
      "https://evil.example.org/{tmdbId}",
      "embed/{tmdbId}",
      "/embed/../{tmdbId}",
      "/embed/{unknown}",
      "/embed/{tmdbId}#x",
      "/embed/{tmdbId} x",
      "/a@evil.example.org/{tmdbId}",
    ]) {
      assert.equal(parse({ ...base, movieTemplate }).servers.length, 0, movieTemplate);
    }
  });

  it("requires the placeholder matching the identifier type", () => {
    assert.equal(parse({ ...base, movieTemplate: "/embed/movie/{imdbId}" }).servers.length, 0);
    assert.equal(parse({ ...base, episodeTemplate: "/embed/tv/{tmdbId}" }).servers.length, 0);
    assert.equal(parse({ ...base, identifierType: "imdb" }).servers.length, 0);
    assert.equal(parse({ ...base, identifierType: "ean" }).servers.length, 0);
  });

  it("accepts query-string templates", () => {
    const { servers } = parse({
      ...base,
      movieTemplate: "/embed?video_id={tmdbId}&tmdb=1",
      episodeTemplate: undefined,
    });

    assert.equal(servers.length, 1);
  });
});
