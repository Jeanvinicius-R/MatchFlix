import {
  isCleanHttpsUrl,
  type AdapterFailure,
  type CatalogPage,
  type DiscoveryQuery,
  type PlaybackAdapter,
  type ProviderCandidate,
  type ProviderCatalogItem,
  type ResolvedAsset,
} from "../adapter.types";
import { createLoadingCache } from "./cache";
import { applyAuth, type M3uServerConfig } from "./config";
import { parseM3u, type M3uEntry } from "./m3u-parser";
import {
  parseEpisodeName,
  splitTitleYear,
  titlesMatch,
  yearsClose,
} from "./match-utils";
import {
  OUT_OF_ORIGIN_REASON,
  allowedOriginsFor,
  createServerHttp,
  extensionOfUrl,
  fail,
  finalizeAsset,
  isOnAllowedOrigin,
  mediaFromExtension,
  originOf,
  sameHost,
  toProxiedMedia,
  type BrowserMedia,
  type MediaTarget,
} from "./shared";

/**
 * M3U playlist run (or licensed) by the operator. The playlist is only ever
 * fetched by the backend and its CONTENT IS NOT TRUSTED: an entry is playable
 * only when its URL sits on the server's origin or on a configured
 * "mediaOrigins" entry. Entries are identified by a hash of their URL, so the
 * credentials some URLs embed never travel in an asset id.
 *
 * Playable entries are served through the proxy (the playlist owner decides what
 * is secret, we cannot tell a token in a path from a plain segment). DASH has no
 * proxy support, so it is only allowed as a PUBLIC url: https, no credentials, no
 * query, no auth, no private network.
 */

const PLAYLIST_TTL_MS = 10 * 60 * 1000;
const MAX_PLAYLIST_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 200;
const MAX_CANDIDATES = 5;

const ASSET_ID = /^m3u:[0-9a-f]{12}$/;

const WHAT = "a playlist M3U";

/** An entry the adapter may suggest: supported format, allowed origin. */
interface CatalogEntry {
  entry: M3uEntry;
  kind: "MOVIE" | "EPISODE";
  title: string;
  year?: number;
  seriesTitle?: string;
  season?: number;
  episode?: number;
}

interface Playlist {
  /** Every entry, so resolve() can explain why a known one is refused. */
  byId: Map<string, M3uEntry>;
  items: CatalogEntry[];
}

function formatEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function classify(entry: M3uEntry): CatalogEntry | null {
  const episode = parseEpisodeName(entry.name);

  if (episode) {
    return {
      entry,
      kind: "EPISODE",
      title: `${episode.seriesTitle} ${formatEpisode(episode.season, episode.episode)}`,
      seriesTitle: episode.seriesTitle,
      season: episode.season,
      episode: episode.episode,
    };
  }

  const { title, year } = splitTitleYear(entry.name);

  if (title === "") {
    return null;
  }

  return year === undefined
    ? { entry, kind: "MOVIE", title }
    : { entry, kind: "MOVIE", title, year };
}

/** Userinfo ("https://user:pw@host/...") cannot be carried by the proxy. */
function hasEmbeddedCredentials(raw: string): boolean {
  try {
    const url = new URL(raw);

    return url.username !== "" || url.password !== "";
  } catch {
    return true;
  }
}

/** A URL the browser could fetch on its own without leaking anything. */
function isPublicDashUrl(raw: string): boolean {
  try {
    return isCleanHttpsUrl(raw) && new URL(raw).search === "";
  } catch {
    return false;
  }
}

function toCandidate(item: CatalogEntry): ProviderCandidate {
  const candidate: ProviderCandidate = {
    providerAssetId: item.entry.id,
    title: item.title,
  };

  if (item.year !== undefined) {
    candidate.year = item.year;
  }

  return candidate;
}

function toCatalogItem(item: CatalogEntry): ProviderCatalogItem {
  const catalog: ProviderCatalogItem = {
    ...toCandidate(item),
    mediaType: item.kind,
  };

  if (item.kind === "EPISODE") {
    catalog.seriesTitle = item.seriesTitle;
    catalog.seasonNumber = item.season;
    catalog.episodeNumber = item.episode;
  }

  return catalog;
}

export interface M3uAdapterOptions {
  config: M3uServerConfig;
  fetchImpl?: typeof fetch;
  /** Injected clock for the playlist cache (tests). */
  now?: () => number;
  /** Checks that the media really answers before resolve() succeeds (default true). */
  probe?: boolean;
}

export function createM3uAdapter(options: M3uAdapterOptions): PlaybackAdapter {
  const { config } = options;
  const http = createServerHttp({
    fetchImpl: options.fetchImpl,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  const allowedOrigins = allowedOriginsFor(config.playlistUrl, config.mediaOrigins);
  const playlistOrigin = originOf(config.playlistUrl);
  const cache = createLoadingCache<Playlist>({ ttlMs: PLAYLIST_TTL_MS, now: options.now });

  function loadPlaylist(signal: AbortSignal) {
    return cache.load(async () => {
      const applied = applyAuth(config.auth, config.playlistUrl);
      const result = await http.text(applied.url, {
        signal,
        what: WHAT,
        allowedHost: sameHost(config.playlistUrl),
        headers: applied.headers,
        maxBytes: MAX_PLAYLIST_BYTES,
        accept: "application/x-mpegurl, audio/mpegurl, text/plain, */*",
      });

      if (!result.ok) {
        return fail(result.reason);
      }

      const entries = parseM3u(result.data);

      if (entries.length === 0) {
        return fail("A playlist M3U está vazia ou não é uma playlist válida.");
      }

      const playlist: Playlist = { byId: new Map(), items: [] };

      for (const entry of entries) {
        playlist.byId.set(entry.id, entry);

        const classified = classify(entry);

        if (
          classified !== null &&
          !hasEmbeddedCredentials(entry.url) &&
          mediaFromExtension(extensionOfUrl(entry.url)) !== null &&
          isOnAllowedOrigin(entry.url, allowedOrigins)
        ) {
          playlist.items.push(classified);
        }
      }

      return playlist;
    });
  }

  async function toAsset(
    entry: M3uEntry,
    signal: AbortSignal,
  ): Promise<ResolvedAsset | AdapterFailure> {
    if (!isOnAllowedOrigin(entry.url, allowedOrigins)) {
      return fail(OUT_OF_ORIGIN_REASON);
    }

    const media: BrowserMedia | null = mediaFromExtension(extensionOfUrl(entry.url));

    if (media === null) {
      return fail("Formato não suportado pelo navegador (sem transcodificação).");
    }

    const finalize = (target: MediaTarget) =>
      finalizeAsset({
        http,
        signal,
        label: config.label,
        what: WHAT,
        media,
        target,
        allowedOrigins,
        probe: options.probe !== false,
      });

    if (media.type === "dash") {
      if (
        config.auth.type !== "none" ||
        config.allowPrivateNetwork ||
        !isPublicDashUrl(entry.url)
      ) {
        return fail(
          "DASH só é suportado em URLs públicas, sem credenciais e sem autenticação " +
            "(o proxy não reescreve DASH).",
        );
      }

      return finalize({ url: entry.url });
    }

    // The playlist's auth only goes to the playlist's own origin, never to a CDN.
    const proxy = toProxiedMedia({
      url: entry.url,
      auth: originOf(entry.url) === playlistOrigin ? config.auth : { type: "none" },
      media,
      allowedOrigins,
      allowPrivateNetwork: config.allowPrivateNetwork,
    });

    if ("reason" in proxy) {
      return proxy;
    }

    return finalize({ proxy });
  }

  return {
    id: config.id,
    label: config.label,
    assetIdHint:
      'Entrada da playlist "m3u:<12 caracteres hexadecimais>" (use a sincronização para listar).',
    licenseReference: config.licenseReference,
    allowPrivateNetwork: config.allowPrivateNetwork,

    async resolve(assetId, { signal }): Promise<ResolvedAsset | AdapterFailure> {
      const id = assetId.trim();

      if (!ASSET_ID.test(id)) {
        return fail('Identificador M3U inválido (use "m3u:<12 hexadecimais>").');
      }

      const playlist = await loadPlaylist(signal);

      if ("reason" in playlist) {
        return playlist;
      }

      const entry = playlist.byId.get(id);

      return entry
        ? toAsset(entry, signal)
        : fail("Entrada não encontrada na playlist M3U (a lista pode ter mudado).");
    },

    async discover(
      query: DiscoveryQuery,
      { signal },
    ): Promise<ProviderCandidate[] | AdapterFailure> {
      const playlist = await loadPlaylist(signal);

      if ("reason" in playlist) {
        return playlist;
      }

      const wanted = [query.title, query.originalTitle];

      return playlist.items
        .filter((item) =>
          query.mediaType === "MOVIE"
            ? item.kind === "MOVIE" &&
              titlesMatch(wanted, item.title) &&
              yearsClose(item.year, query.year)
            : item.kind === "EPISODE" &&
              item.season === query.seasonNumber &&
              item.episode === query.episodeNumber &&
              titlesMatch(wanted, item.seriesTitle ?? ""),
        )
        .slice(0, MAX_CANDIDATES)
        .map(toCandidate);
    },

    async listCatalog(cursor, { signal }): Promise<CatalogPage | AdapterFailure> {
      if (cursor !== undefined && !/^\d{1,9}$/.test(cursor)) {
        return fail("Cursor do catálogo inválido.");
      }

      const playlist = await loadPlaylist(signal);

      if ("reason" in playlist) {
        return playlist;
      }

      const offset = cursor === undefined ? 0 : Number(cursor);
      const items = playlist.items.slice(offset, offset + PAGE_SIZE).map(toCatalogItem);
      const next = offset + PAGE_SIZE;

      return next < playlist.items.length ? { items, nextCursor: String(next) } : { items };
    },
  };
}
