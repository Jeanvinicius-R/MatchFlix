import {
  isRecord,
  readRecord,
  type AdapterFailure,
  type CatalogPage,
  type DiscoveryQuery,
  type PlaybackAdapter,
  type ProviderCandidate,
  type ProviderCatalogItem,
  type ResolvedAsset,
} from "../adapter.types";
import { createLoadingCache } from "./cache";
import type { XtreamServerConfig } from "./config";
import {
  parseTmdbId,
  parseYear,
  splitTitleYear,
  titlesMatch,
  yearsClose,
} from "./match-utils";
import {
  allowedOriginsFor,
  createServerHttp,
  fail,
  finalizeAsset,
  mediaFromExtension,
  sameHost,
  toProxiedMedia,
} from "./shared";

/**
 * Xtream-Codes style panel run (or licensed) by the operator. The panel is only
 * ever contacted by the backend: the playable URL carries the panel's username
 * and password in its path, so it is ALWAYS returned as proxied media and the
 * browser never sees it.
 *
 *   - "vod:<stream_id>"                   -> get_vod_info
 *   - "series:<series_id>:<season>:<ep>"  -> get_series_info
 *
 * Only mp4/webm (direct) and m3u8 (hls) are accepted: there is no transcoding,
 * so mkv/avi/ts and friends fail closed.
 */

/** The panel catalog is big and slow: shared by all discover() calls of a sync. */
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** A 50k-title panel easily passes the 8 MiB default of fetchJson. */
const MAX_LIST_BYTES = 32 * 1024 * 1024;

const PAGE_SIZE = 200;
const MAX_CANDIDATES = 5;
const MAX_SERIES_LOOKUPS = 3;

const VOD_ASSET_ID = /^vod:(\d{1,12})$/;
const SERIES_ASSET_ID = /^series:(\d{1,12}):(\d{1,4}):(\d{1,5})$/;
const EXTENSION_PATTERN = /^[a-z0-9]{2,5}$/;

const WHAT = "o servidor Xtream";

export function parseXtreamAssetId(
  assetId: string,
):
  | { kind: "vod"; vodId: number }
  | { kind: "series"; seriesId: number; season: number; episode: number }
  | null {
  const vod = VOD_ASSET_ID.exec(assetId);

  if (vod) {
    return { kind: "vod", vodId: Number(vod[1]) };
  }

  const series = SERIES_ASSET_ID.exec(assetId);

  return series
    ? {
        kind: "series",
        seriesId: Number(series[1]),
        season: Number(series[2]),
        episode: Number(series[3]),
      }
    : null;
}

interface VodEntry {
  streamId: number;
  title: string;
  year?: number;
  tmdb?: number;
}

interface SeriesEntry {
  seriesId: number;
  title: string;
  year?: number;
  tmdb?: number;
}

/** A positive integer from a number or a digits-only string (panels send either). */
function parseNumericId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d{1,12}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

/** An integer >= 0 (season 0 = specials) from a number or a digits-only string. */
function parseCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  return typeof value === "string" && /^\d{1,6}$/.test(value.trim())
    ? Number(value.trim())
    : undefined;
}

function readExtension(value: unknown): string | undefined {
  const extension = typeof value === "string" ? value.trim().toLowerCase() : "";

  return EXTENSION_PATTERN.test(extension) ? extension : undefined;
}

function toEntry(item: Record<string, unknown>, idKey: string) {
  const id = parseNumericId(item[idKey]);
  const name = typeof item.name === "string" ? item.name : "";
  const { title, year: nameYear } = splitTitleYear(name);

  if (id === undefined || title === "") {
    return null;
  }

  // Only a NUMERIC tmdb field counts; many panels leave it empty or "0".
  const tmdb = parseTmdbId(item.tmdb) ?? parseTmdbId(item.tmdb_id);
  const year = parseYear(item.year) ?? nameYear ?? parseYear(item.releaseDate);

  return { id, title, year, tmdb };
}

function parseVodList(data: unknown): VodEntry[] | null {
  if (!Array.isArray(data)) {
    return null;
  }

  const list: VodEntry[] = [];

  for (const item of data as unknown[]) {
    const entry = isRecord(item) ? toEntry(item, "stream_id") : null;

    if (entry) {
      list.push({
        streamId: entry.id,
        title: entry.title,
        year: entry.year,
        tmdb: entry.tmdb,
      });
    }
  }

  return list;
}

function parseSeriesList(data: unknown): SeriesEntry[] | null {
  if (!Array.isArray(data)) {
    return null;
  }

  const list: SeriesEntry[] = [];

  for (const item of data as unknown[]) {
    const entry = isRecord(item) ? toEntry(item, "series_id") : null;

    if (entry) {
      list.push({
        seriesId: entry.id,
        title: entry.title,
        year: entry.year,
        tmdb: entry.tmdb,
      });
    }
  }

  return list;
}

/** Every episode entry of a get_series_info answer, tagged with the season key. */
function collectEpisodes(
  episodes: unknown,
): { seasonKey: string | undefined; entry: Record<string, unknown> }[] {
  const found: { seasonKey: string | undefined; entry: Record<string, unknown> }[] = [];

  function addAll(seasonKey: string | undefined, list: unknown) {
    if (!Array.isArray(list)) {
      return;
    }

    for (const entry of list as unknown[]) {
      if (isRecord(entry)) {
        found.push({ seasonKey, entry });
      }
    }
  }

  if (Array.isArray(episodes)) {
    // Some panels answer an array of seasons (or of episodes).
    for (const element of episodes as unknown[]) {
      if (Array.isArray(element)) {
        addAll(undefined, element);
      } else if (isRecord(element)) {
        found.push({ seasonKey: undefined, entry: element });
      }
    }
  } else if (isRecord(episodes)) {
    for (const [key, list] of Object.entries(episodes)) {
      addAll(key, list);
    }
  }

  return found;
}

function findEpisode(
  data: Record<string, unknown>,
  season: number,
  episode: number,
): { episodeId: number; extension: string | undefined } | null {
  for (const { seasonKey, entry } of collectEpisodes(data.episodes)) {
    const entrySeason = parseCount(entry.season) ?? parseCount(seasonKey);
    const entryEpisode = parseCount(entry.episode_num);
    const episodeId = parseNumericId(entry.id);

    if (entrySeason === season && entryEpisode === episode && episodeId !== undefined) {
      return { episodeId, extension: readExtension(entry.container_extension) };
    }
  }

  return null;
}

function formatEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export interface XtreamAdapterOptions {
  config: XtreamServerConfig;
  fetchImpl?: typeof fetch;
  /** Injected clock for the catalog cache (tests). */
  now?: () => number;
  /** Checks that the video file really answers before resolve() succeeds (default true). */
  probe?: boolean;
}

export function createXtreamAdapter(options: XtreamAdapterOptions): PlaybackAdapter {
  const { config } = options;
  const http = createServerHttp({
    fetchImpl: options.fetchImpl,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  const allowedHost = sameHost(config.baseUrl);
  const allowedOrigins = allowedOriginsFor(config.baseUrl, config.mediaOrigins);
  const vodCache = createLoadingCache<VodEntry[]>({ ttlMs: CATALOG_TTL_MS, now: options.now });
  const seriesCache = createLoadingCache<SeriesEntry[]>({
    ttlMs: CATALOG_TTL_MS,
    now: options.now,
  });

  function apiUrl(action: string, params: Record<string, string> = {}): string {
    const url = new URL(`${config.baseUrl}/player_api.php`);

    url.searchParams.set("username", config.username);
    url.searchParams.set("password", config.password);
    url.searchParams.set("action", action);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  function call(
    action: string,
    params: Record<string, string>,
    signal: AbortSignal,
    maxBytes?: number,
  ) {
    return http.json<unknown>(apiUrl(action, params), {
      signal,
      what: WHAT,
      allowedHost,
      maxBytes,
    });
  }

  /** `${base}/<segment>/<user>/<pass>/<id>.<ext>`, as the proxied (never public) media. */
  async function toAsset(
    segment: "movie" | "series",
    streamId: number,
    extension: string | undefined,
    signal: AbortSignal,
  ): Promise<ResolvedAsset | AdapterFailure> {
    if (extension === undefined) {
      return fail("O servidor Xtream não informou o formato do vídeo.");
    }

    const media = mediaFromExtension(extension);

    if (media === null || media.type === "dash") {
      return fail(
        `Formato não suportado pelo navegador (sem transcodificação): "${extension}".`,
      );
    }

    const upstreamUrl = [
      config.baseUrl,
      segment,
      encodeURIComponent(config.username),
      encodeURIComponent(config.password),
      `${streamId}.${extension}`,
    ].join("/");
    const proxy = toProxiedMedia({
      url: upstreamUrl,
      auth: { type: "none" },
      media,
      allowedOrigins,
      allowPrivateNetwork: config.allowPrivateNetwork,
    });

    if ("reason" in proxy) {
      return proxy;
    }

    return finalizeAsset({
      http,
      signal,
      label: config.label,
      what: WHAT,
      media,
      target: { proxy },
      allowedOrigins,
      probe: options.probe !== false,
    });
  }

  function loadVod(signal: AbortSignal) {
    return vodCache.load(async () => {
      const result = await call("get_vod_streams", {}, signal, MAX_LIST_BYTES);

      if (!result.ok) {
        return fail(result.reason);
      }

      return parseVodList(result.data) ?? fail("O servidor Xtream devolveu uma lista inválida.");
    });
  }

  function loadSeries(signal: AbortSignal) {
    return seriesCache.load(async () => {
      const result = await call("get_series", {}, signal, MAX_LIST_BYTES);

      if (!result.ok) {
        return fail(result.reason);
      }

      return (
        parseSeriesList(result.data) ?? fail("O servidor Xtream devolveu uma lista inválida.")
      );
    });
  }

  async function resolveVod(vodId: number, signal: AbortSignal) {
    const result = await call("get_vod_info", { vod_id: String(vodId) }, signal);

    if (!result.ok) {
      return fail(result.reason);
    }

    if (!isRecord(result.data)) {
      return fail("Filme não encontrado no servidor Xtream.");
    }

    const movieData = readRecord(result.data, "movie_data");
    const streamId = parseNumericId(movieData.stream_id) ?? vodId;

    return toAsset("movie", streamId, readExtension(movieData.container_extension), signal);
  }

  async function resolveEpisode(
    seriesId: number,
    season: number,
    episode: number,
    signal: AbortSignal,
  ) {
    const result = await call("get_series_info", { series_id: String(seriesId) }, signal);

    if (!result.ok) {
      return fail(result.reason);
    }

    const found = isRecord(result.data) ? findEpisode(result.data, season, episode) : null;

    if (found === null) {
      return fail("Episódio não encontrado no servidor Xtream.");
    }

    return toAsset("series", found.episodeId, found.extension, signal);
  }

  async function discoverMovie(
    query: DiscoveryQuery,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[] | AdapterFailure> {
    const list = await loadVod(signal);

    if ("reason" in list) {
      return list;
    }

    const wanted = [query.title, query.originalTitle];
    const byId: VodEntry[] = [];
    const byTitle: VodEntry[] = [];

    for (const entry of list) {
      if (entry.tmdb === query.tmdbId) {
        byId.push(entry);
      } else if (
        // An id the panel declares for ANOTHER title rules the entry out.
        entry.tmdb === undefined &&
        titlesMatch(wanted, entry.title) &&
        yearsClose(entry.year, query.year)
      ) {
        byTitle.push(entry);
      }
    }

    return [...byId, ...byTitle].slice(0, MAX_CANDIDATES).map((entry) => {
      const candidate: ProviderCandidate = {
        providerAssetId: `vod:${entry.streamId}`,
        title: entry.title,
      };

      if (entry.year !== undefined) {
        candidate.year = entry.year;
      }

      if (entry.tmdb !== undefined) {
        candidate.externalIds = { tmdb: entry.tmdb };
      }

      return candidate;
    });
  }

  async function discoverEpisode(
    query: DiscoveryQuery,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[] | AdapterFailure> {
    const list = await loadSeries(signal);

    if ("reason" in list) {
      return list;
    }

    const wanted = [query.title, query.originalTitle];
    const matches = list
      .filter(
        (entry) =>
          entry.tmdb === query.tmdbId ||
          (entry.tmdb === undefined && titlesMatch(wanted, entry.title)),
      )
      .slice(0, MAX_SERIES_LOOKUPS);

    const candidates: ProviderCandidate[] = [];
    let firstFailure: AdapterFailure | null = null;

    for (const series of matches) {
      const info = await call("get_series_info", { series_id: String(series.seriesId) }, signal);

      if (!info.ok) {
        if (firstFailure === null) {
          firstFailure = fail(info.reason);
        }

        continue;
      }

      const found = isRecord(info.data)
        ? findEpisode(info.data, query.seasonNumber, query.episodeNumber)
        : null;

      if (found === null) {
        continue;
      }

      const candidate: ProviderCandidate = {
        providerAssetId: `series:${series.seriesId}:${query.seasonNumber}:${query.episodeNumber}`,
        title: `${series.title} ${formatEpisode(query.seasonNumber, query.episodeNumber)}`,
      };

      if (series.year !== undefined) {
        candidate.year = series.year;
      }

      if (series.tmdb === query.tmdbId) {
        candidate.externalIds = { tmdb: series.tmdb };
      }

      candidates.push(candidate);
    }

    return candidates.length === 0 && firstFailure !== null ? firstFailure : candidates;
  }

  return {
    id: config.id,
    label: config.label,
    assetIdHint:
      'Filme "vod:<stream_id>" (ex.: "vod:1234") ou episódio "series:<series_id>:<temporada>:<episódio>" (ex.: "series:55:1:3").',
    licenseReference: config.licenseReference,
    allowPrivateNetwork: config.allowPrivateNetwork,

    async resolve(assetId, { signal }): Promise<ResolvedAsset | AdapterFailure> {
      const parsed = parseXtreamAssetId(assetId.trim());

      if (!parsed) {
        return fail('Identificador Xtream inválido (use "vod:<id>" ou "series:<id>:<t>:<e>").');
      }

      return parsed.kind === "vod"
        ? resolveVod(parsed.vodId, signal)
        : resolveEpisode(parsed.seriesId, parsed.season, parsed.episode, signal);
    },

    discover(query, { signal }) {
      return query.mediaType === "MOVIE"
        ? discoverMovie(query, signal)
        : discoverEpisode(query, signal);
    },

    async listCatalog(cursor, { signal }): Promise<CatalogPage | AdapterFailure> {
      if (cursor !== undefined && !/^\d{1,9}$/.test(cursor)) {
        return fail("Cursor do catálogo inválido.");
      }

      const list = await loadVod(signal);

      if ("reason" in list) {
        return list;
      }

      const offset = cursor === undefined ? 0 : Number(cursor);
      const items: ProviderCatalogItem[] = list.slice(offset, offset + PAGE_SIZE).map((entry) => {
        const item: ProviderCatalogItem = {
          providerAssetId: `vod:${entry.streamId}`,
          title: entry.title,
          mediaType: "MOVIE",
        };

        if (entry.year !== undefined) {
          item.year = entry.year;
        }

        if (entry.tmdb !== undefined) {
          item.externalIds = { tmdb: entry.tmdb };
        }

        return item;
      });
      const next = offset + PAGE_SIZE;

      return next < list.length ? { items, nextCursor: String(next) } : { items };
    },
  };
}
