import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { M3uServerConfig } from "./config";
import { createM3uAdapter } from "./m3u.adapter";
import { hashEntryUrl } from "./m3u-parser";
import {
  expectAsset,
  expectFailure,
  fakeFetch,
  signal,
  text,
} from "./test-support";

const HOST = "https://media.example.com";

const URLS = {
  matrix: `${HOST}/vod/matrix.mp4`,
  episode: `${HOST}/vod/bb-s01e03.m3u8?token=abc`,
  mkv: `${HOST}/vod/x.mkv`,
  evil: "https://evil.example.org/vod/e.mp4",
  dash: `${HOST}/vod/d.mpd`,
  live: `${HOST}/live/1.ts`,
  userinfo: "https://user:pw@media.example.com/vod/u.mp4",
};

const PLAYLIST = [
  "#EXTM3U",
  '#EXTINF:-1 tvg-id="x" group-title="Filmes",Matrix (1999)',
  URLS.matrix,
  '#EXTINF:-1 group-title="Series",Breaking Bad S01E03',
  URLS.episode,
  "#EXTINF:-1,Filme MKV",
  URLS.mkv,
  "#EXTINF:-1,Fora da origem",
  URLS.evil,
  "#EXTINF:-1,Filme Dash (2010)",
  URLS.dash,
  "#EXTINF:-1,Canal ao vivo",
  URLS.live,
  "#EXTINF:-1,Com usuario",
  URLS.userinfo,
  "",
].join("\n");

const config: M3uServerConfig = {
  id: "lista",
  label: "Lista do operador",
  kind: "m3u",
  playlistUrl: `${HOST}/lists/main.m3u`,
  auth: { type: "bearer", token: "tok-secret" },
  licenseReference: "Contrato de licenciamento 77/2026",
  allowPrivateNetwork: false,
  mediaOrigins: [],
};

function playlistServer(body = PLAYLIST) {
  return fakeFetch(() => text(body));
}

function adapterFor(
  overrides: Partial<M3uServerConfig> = {},
  body = PLAYLIST,
  now?: () => number,
) {
  const fake = playlistServer(body);
  const adapter = createM3uAdapter({
    config: { ...config, ...overrides },
    fetchImpl: fake.impl,
    probe: false,
    now,
  });

  return { fake, adapter };
}

const id = (key: keyof typeof URLS) => hashEntryUrl(URLS[key]);

describe("m3u adapter: catalog and discovery", () => {
  it("fetches the playlist with the configured auth", async () => {
    const { adapter, fake } = adapterFor();

    await adapter.listCatalog?.(undefined, signal());

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].url, `${HOST}/lists/main.m3u`);
    assert.equal(fake.calls[0].headers.Authorization, "Bearer tok-secret");
  });

  it("lists only supported entries on allowed origins, without embedded credentials", async () => {
    const { adapter } = adapterFor();
    const page = await adapter.listCatalog?.(undefined, signal());

    assert.ok(page && !("reason" in page));
    assert.equal(page.nextCursor, undefined);
    assert.deepEqual(
      page.items.map((item) => ({
        id: item.providerAssetId,
        title: item.title,
        year: item.year,
        mediaType: item.mediaType,
        seriesTitle: item.seriesTitle,
        season: item.seasonNumber,
        episode: item.episodeNumber,
        externalIds: item.externalIds,
      })),
      [
        {
          id: id("matrix"),
          title: "Matrix",
          year: 1999,
          mediaType: "MOVIE",
          seriesTitle: undefined,
          season: undefined,
          episode: undefined,
          externalIds: undefined,
        },
        {
          id: id("episode"),
          title: "Breaking Bad S01E03",
          year: undefined,
          mediaType: "EPISODE",
          seriesTitle: "Breaking Bad",
          season: 1,
          episode: 3,
          externalIds: undefined,
        },
        {
          id: id("dash"),
          title: "Filme Dash",
          year: 2010,
          mediaType: "MOVIE",
          seriesTitle: undefined,
          season: undefined,
          episode: undefined,
          externalIds: undefined,
        },
      ],
    );
  });

  it("discovers a movie by title and year", async () => {
    const { adapter } = adapterFor();
    const found = await adapter.discover?.(
      {
        tmdbId: 603,
        mediaType: "MOVIE",
        seasonNumber: 0,
        episodeNumber: 0,
        title: "Matrix",
        year: 2000,
      },
      signal(),
    );

    assert.ok(found && !("reason" in found));
    assert.deepEqual(
      found.map((candidate) => candidate.providerAssetId),
      [id("matrix")],
    );
    assert.equal(found[0].externalIds, undefined, "the playlist never declares TMDB ids");
  });

  it("does not suggest a movie whose year is far off", async () => {
    const { adapter } = adapterFor();
    const found = await adapter.discover?.(
      {
        tmdbId: 603,
        mediaType: "MOVIE",
        seasonNumber: 0,
        episodeNumber: 0,
        title: "Matrix",
        year: 2015,
      },
      signal(),
    );

    assert.ok(found && !("reason" in found));
    assert.deepEqual(found, []);
  });

  it("discovers an episode by series title, season and episode", async () => {
    const { adapter } = adapterFor();
    const query = {
      tmdbId: 1396,
      mediaType: "EPISODE" as const,
      seasonNumber: 1,
      episodeNumber: 3,
      title: "Breaking Bad",
    };
    const found = await adapter.discover?.(query, signal());

    assert.ok(found && !("reason" in found));
    assert.deepEqual(
      found.map((candidate) => candidate.providerAssetId),
      [id("episode")],
    );

    const other = await adapter.discover?.({ ...query, episodeNumber: 4 }, signal());

    assert.deepEqual(other, []);
  });

  it("caches the playlist for ten minutes", async () => {
    let clock = 0;
    const { adapter, fake } = adapterFor({}, PLAYLIST, () => clock);

    await adapter.listCatalog?.(undefined, signal());
    await adapter.listCatalog?.(undefined, signal());
    assert.equal(fake.calls.length, 1);

    clock += 10 * 60 * 1000 + 1;
    await adapter.listCatalog?.(undefined, signal());
    assert.equal(fake.calls.length, 2);
  });

  it("refuses a body that is not a playlist", async () => {
    const { adapter } = adapterFor({}, "<html>erro</html>");

    assert.match(
      expectFailure(await adapter.listCatalog?.(undefined, signal())),
      /vazia ou não é uma playlist válida/,
    );
  });

  it("rejects a bad cursor", async () => {
    const { adapter } = adapterFor();

    assert.match(
      expectFailure(await adapter.listCatalog?.("abc", signal())),
      /Cursor do catálogo inválido/,
    );
  });
});

describe("m3u adapter: resolve", () => {
  it("proxies a movie with the playlist's auth on the playlist origin", async () => {
    const { adapter } = adapterFor();
    const asset = expectAsset(await adapter.resolve(id("matrix"), signal()));

    assert.equal(asset.url, undefined);
    assert.equal(asset.type, "direct");
    assert.equal(asset.mimeType, "video/mp4");
    assert.equal(asset.proxy?.upstreamUrl, URLS.matrix);
    assert.deepEqual(asset.proxy?.headers, { Authorization: "Bearer tok-secret" });
    assert.deepEqual(asset.proxy?.allowedOrigins, [HOST]);
    assert.equal(adapter.licenseReference, "Contrato de licenciamento 77/2026");
  });

  it("keeps the query string of an HLS entry and maps the type", async () => {
    const { adapter } = adapterFor();
    const asset = expectAsset(await adapter.resolve(id("episode"), signal()));

    assert.equal(asset.type, "hls");
    assert.equal(asset.proxy?.upstreamUrl, URLS.episode);
  });

  it("never sends the playlist's auth to a media CDN", async () => {
    const cdnUrl = "https://cdn.example.com/f/a.mp4";
    const playlist = `#EXTM3U\n#EXTINF:-1,Filme CDN (2001)\n${cdnUrl}\n`;
    const { adapter } = adapterFor({ mediaOrigins: ["https://cdn.example.com"] }, playlist);
    const asset = expectAsset(await adapter.resolve(hashEntryUrl(cdnUrl), signal()));

    assert.equal(asset.proxy?.upstreamUrl, cdnUrl);
    assert.equal(asset.proxy?.headers, undefined);
    assert.deepEqual(asset.proxy?.allowedOrigins, [HOST, "https://cdn.example.com"]);
  });

  it("refuses an entry outside the allowed origins", async () => {
    const { adapter } = adapterFor();

    assert.match(
      expectFailure(await adapter.resolve(id("evil"), signal())),
      /fora das origens permitidas/,
    );
  });

  it("refuses formats the browser cannot play", async () => {
    const { adapter } = adapterFor();

    assert.match(
      expectFailure(await adapter.resolve(id("mkv"), signal())),
      /não suportado pelo navegador/,
    );
    assert.match(
      expectFailure(await adapter.resolve(id("live"), signal())),
      /não suportado pelo navegador/,
    );
  });

  it("refuses URLs with embedded user and password", async () => {
    const { adapter } = adapterFor();
    const reason = expectFailure(await adapter.resolve(id("userinfo"), signal()));

    assert.match(reason, /usuário e senha/);
    assert.ok(!reason.includes("pw"));
  });

  it("refuses DASH when the server needs auth", async () => {
    const { adapter } = adapterFor();

    assert.match(expectFailure(await adapter.resolve(id("dash"), signal())), /DASH só é suportado/);
  });

  it("serves DASH only as a public URL (no auth, no proxy)", async () => {
    const { adapter } = adapterFor({ auth: { type: "none" } });
    const asset = expectAsset(await adapter.resolve(id("dash"), signal()));

    assert.equal(asset.type, "dash");
    assert.equal(asset.url, URLS.dash);
    assert.equal(asset.proxy, undefined);
  });

  it("refuses DASH on a declared private network", async () => {
    const { adapter } = adapterFor({ auth: { type: "none" }, allowPrivateNetwork: true });

    assert.match(expectFailure(await adapter.resolve(id("dash"), signal())), /DASH só é suportado/);
  });

  it("validates the id and reports unknown entries", async () => {
    const { adapter, fake } = adapterFor();

    assert.match(expectFailure(await adapter.resolve("http://evil/x.mp4", signal())), /inválido/);
    assert.equal(fake.calls.length, 0, "an invalid id never reaches the network");
    assert.match(
      expectFailure(await adapter.resolve("m3u:000000000000", signal())),
      /Entrada não encontrada/,
    );
  });

  it("carries allowPrivateNetwork into the proxy description", async () => {
    const { adapter } = adapterFor({ allowPrivateNetwork: true });
    const asset = expectAsset(await adapter.resolve(id("matrix"), signal()));

    assert.equal(asset.proxy?.allowPrivateNetwork, true);
    assert.equal(adapter.allowPrivateNetwork, true);
  });

  it("reports an unreachable playlist without leaking the token", async () => {
    const impl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    const adapter = createM3uAdapter({ config, fetchImpl: impl, probe: false });
    const reason = expectFailure(await adapter.resolve(id("matrix"), signal()));

    assert.match(reason, /Falha de rede/);
    assert.ok(!reason.includes("tok-secret"));
  });
});
