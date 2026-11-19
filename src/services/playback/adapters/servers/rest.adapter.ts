import {
  isCleanHttpsUrl,
  type AdapterFailure,
  type DiscoveryQuery,
  type PlaybackAdapter,
  type ProviderCandidate,
  type ResolvedAsset,
} from "../adapter.types";
import { applyAuth, type RestServerConfig } from "./config";
import { readPath, readPathId, readPathString } from "./json-path";
import {
  parseImdbId,
  parseTmdbId,
  parseYear,
  titlesMatch,
  yearsClose,
} from "./match-utils";
import {
  OUT_OF_ORIGIN_REASON,
  allowedOriginsFor,
  createServerHttp,
  fail,
  finalizeAsset,
  isOnAllowedOrigin,
  mediaFromExtension,
  extensionOfUrl,
  originOf,
  sameHost,
  toProxiedMedia,
  type BrowserMedia,
  type MediaTarget,
} from "./shared";

/**
 * Generic JSON API of a catalog the operator owns or licensed. The config says
 * where things live (dot-paths), so no provider-specific code is needed:
 *
 *   GET {baseUrl}{assetPath with {assetId}}  ->  JSON with the media URL at `urlPath`
 *
 * Every value that goes into a URL is encodeURIComponent-ed and the final URL
 * is checked to stay on the server's origin and path. The JSON is NOT trusted:
 * the media URL must be https and sit on the server origin or a configured
 * "mediaOrigins" entry.
 */

const ASSET_ID = /^[A-Za-z0-9._~:-]{1,200}$/;
const MAX_CANDIDATES = 5;
const MAX_ITEMS_SCANNED = 100;

const WHAT = "a API do servidor";

/** What a "type" field may say, mapped to the extension the browser logic knows. */
const DECLARED_TYPES: ReadonlyMap<string, string> = new Map([
  ["hls", "m3u8"],
  ["m3u8", "m3u8"],
  ["application/vnd.apple.mpegurl", "m3u8"],
  ["application/x-mpegurl", "m3u8"],
  ["dash", "mpd"],
  ["mpd", "mpd"],
  ["application/dash+xml", "mpd"],
  ["direct", "mp4"],
  ["mp4", "mp4"],
  ["video/mp4", "mp4"],
  ["webm", "webm"],
  ["video/webm", "webm"],
]);

/** The provider's id as a path/query value: no traversal, never "." or "..". */
export function isValidRestAssetId(assetId: string): boolean {
  return ASSET_ID.test(assetId) && !assetId.includes("..") && assetId !== ".";
}

function mediaFromDeclaration(declared: string | undefined, url: string): BrowserMedia | null {
  const extension =
    declared === undefined ? undefined : DECLARED_TYPES.get(declared.trim().toLowerCase());

  return mediaFromExtension(extension ?? extensionOfUrl(url));
}

export interface RestAdapterOptions {
  config: RestServerConfig;
  fetchImpl?: typeof fetch;
  /** Checks that the media really answers before resolve() succeeds (default true). */
  probe?: boolean;
}

export function createRestAdapter(options: RestAdapterOptions): PlaybackAdapter {
  const { config } = options;
  const http = createServerHttp({
    fetchImpl: options.fetchImpl,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  const base = new URL(config.baseUrl);
  const allowedHost = sameHost(config.baseUrl);
  const allowedOrigins = allowedOriginsFor(config.baseUrl, config.mediaOrigins);

  /** `baseUrl + template` with every {placeholder} encoded; null if it leaves the server. */
  function buildUrl(template: string, values: Record<string, string>): string | null {
    const path = template.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) =>
      encodeURIComponent(values[name] ?? ""),
    );

    try {
      const url = new URL(`${config.baseUrl}${path}`);

      return url.origin === base.origin && url.pathname.startsWith(base.pathname)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  function callApi(url: string, signal: AbortSignal) {
    const applied = applyAuth(config.auth, url);

    return http.json<unknown>(applied.url, {
      signal,
      what: WHAT,
      allowedHost,
      headers: applied.headers,
    });
  }

  async function resolveAsset(
    assetId: string,
    signal: AbortSignal,
  ): Promise<ResolvedAsset | AdapterFailure> {
    const id = assetId.trim();

    if (!isValidRestAssetId(id)) {
      return fail("Identificador inválido para este servidor.");
    }

    const url = buildUrl(config.assetPath, { assetId: id });

    if (url === null) {
      return fail("Não foi possível montar a URL da API do servidor.");
    }

    const result = await callApi(url, signal);

    if (!result.ok) {
      return fail(result.reason);
    }

    const mediaUrl = readPathString(result.data, config.urlPath);

    if (mediaUrl === undefined) {
      return fail("A API do servidor não informou a URL do vídeo.");
    }

    if (!isCleanHttpsUrl(mediaUrl)) {
      return fail("A API do servidor devolveu uma URL de vídeo que não é https.");
    }

    if (!isOnAllowedOrigin(mediaUrl, allowedOrigins)) {
      return fail(OUT_OF_ORIGIN_REASON);
    }

    const declared = config.typePath ? readPathString(result.data, config.typePath) : undefined;
    const media = mediaFromDeclaration(declared, mediaUrl);

    if (media === null) {
      return fail("Formato de vídeo não suportado pelo navegador (sem transcodificação).");
    }

    let target: MediaTarget;

    if (config.mediaNeedsAuth || config.allowPrivateNetwork) {
      const proxy = toProxiedMedia({
        url: mediaUrl,
        // The JSON is untrusted: credentials go only to the server's own origin,
        // never to another mediaOrigin it happened to name (same rule as M3U).
        auth:
          config.mediaNeedsAuth && originOf(mediaUrl) === originOf(config.baseUrl)
            ? config.auth
            : { type: "none" },
        media,
        allowedOrigins,
        allowPrivateNetwork: config.allowPrivateNetwork,
      });

      if ("reason" in proxy) {
        return proxy;
      }

      target = { proxy };
    } else {
      target = { url: mediaUrl };
    }

    return finalizeAsset({
      http,
      signal,
      label: config.label,
      what: WHAT,
      media,
      target,
      allowedOrigins,
      probe: options.probe !== false,
    });
  }

  async function searchTitles(
    query: DiscoveryQuery,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[] | AdapterFailure> {
    // The search template only knows the title, so episodes are not searched.
    if (config.searchPath === undefined || query.mediaType !== "MOVIE") {
      return [];
    }

    const url = buildUrl(config.searchPath, {
      tmdbId: String(query.tmdbId),
      imdbId: query.imdbId ?? "",
      title: query.title,
      year: query.year === undefined ? "" : String(query.year),
    });

    if (url === null) {
      return fail("Não foi possível montar a URL de busca da API do servidor.");
    }

    const result = await callApi(url, signal);

    if (!result.ok) {
      return fail(result.reason);
    }

    const list =
      config.itemsPath === undefined ? result.data : readPath(result.data, config.itemsPath);

    if (!Array.isArray(list)) {
      return fail("A busca da API do servidor devolveu um formato inesperado.");
    }

    const idPath = config.idPath ?? "id";
    const titlePath = config.titlePath ?? "title";
    const wanted = [query.title, query.originalTitle];
    const byId: ProviderCandidate[] = [];
    const byTitle: ProviderCandidate[] = [];

    for (const item of (list as unknown[]).slice(0, MAX_ITEMS_SCANNED)) {
      const providerAssetId = readPathId(item, idPath);
      const title = readPathString(item, titlePath);

      if (providerAssetId === undefined || !isValidRestAssetId(providerAssetId) || !title) {
        continue;
      }

      const tmdb = config.tmdbPath ? parseTmdbId(readPath(item, config.tmdbPath)) : undefined;
      const imdb = config.imdbPath ? parseImdbId(readPath(item, config.imdbPath)) : undefined;
      const year = config.yearPath ? parseYear(readPath(item, config.yearPath)) : undefined;

      // An identifier the provider declares for ANOTHER title rules the item out.
      if (
        (tmdb !== undefined && tmdb !== query.tmdbId) ||
        (imdb !== undefined && query.imdbId !== undefined && imdb !== query.imdbId)
      ) {
        continue;
      }

      const candidate: ProviderCandidate = { providerAssetId, title };

      if (year !== undefined) {
        candidate.year = year;
      }

      if (tmdb !== undefined || imdb !== undefined) {
        const externalIds: NonNullable<ProviderCandidate["externalIds"]> = {};

        if (tmdb !== undefined) {
          externalIds.tmdb = tmdb;
        }

        if (imdb !== undefined) {
          externalIds.imdb = imdb;
        }

        candidate.externalIds = externalIds;
      }

      const sameId = tmdb === query.tmdbId || (imdb !== undefined && imdb === query.imdbId);

      if (sameId) {
        byId.push(candidate);
      } else if (titlesMatch(wanted, title) && yearsClose(year, query.year)) {
        byTitle.push(candidate);
      }
    }

    return [...byId, ...byTitle].slice(0, MAX_CANDIDATES);
  }

  const adapter: PlaybackAdapter = {
    id: config.id,
    label: config.label,
    assetIdHint:
      "Identificador do vídeo na API do servidor (letras, números, ponto, til, dois-pontos e hífen).",
    licenseReference: config.licenseReference,
    allowPrivateNetwork: config.allowPrivateNetwork,

    resolve(assetId, { signal }) {
      return resolveAsset(assetId, signal);
    },
  };

  if (config.searchPath !== undefined) {
    adapter.discover = (query, { signal }) => searchTitles(query, signal);
  }

  return adapter;
}
