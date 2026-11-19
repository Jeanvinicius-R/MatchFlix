import {
  type AdapterFailure,
  type PlaybackAdapter,
  type ResolvedAsset,
} from "../adapter.types";
import { createSafeFetch } from "../../proxy/safe-fetch";
import type { EmbedIdentifierType, EmbedServerConfig } from "./config";
import { fail } from "./shared";

/**
 * EMBED provider: an external player (iframe) the operator is licensed to embed.
 *
 * The iframe URL is BUILT from a template and the identifiers of an
 * administrator-approved association; nothing here asks the provider whether it
 * has the title. So:
 *
 *   - the asset id is validated field by field before any URL is formed (ids
 *     are digits / "tt"+digits / a plain slug, season/episode are integers), and
 *     the final URL must sit on the configured https origin;
 *   - a built URL is never reported as a confirmed video: the result carries
 *     `unconfirmed`, so a successful check leaves the association "unknown";
 *   - on an admin/cron check the page is requested server-side and refused when
 *     the provider forbids framing (X-Frame-Options / CSP frame-ancestors) or
 *     answers an error. Whether the video then plays is only provable in a
 *     browser (and a cross-origin iframe cannot be inspected from MatchFlix).
 *
 * Asset id formats (movie | episode):
 *   tmdb : "550"          | "1399/1/1"
 *   imdb : "tt0137523"    | "tt0944947/1/1"
 *   asset: "BigBuckBunny" | "slug/1/1"   (the provider's own id)
 */

const TMDB_ID = /^[1-9]\d{0,8}$/;
const IMDB_ID = /^tt\d{6,10}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,99}$/;
const MAX_SEASON = 999;
const MAX_EPISODE = 9999;
const MAX_REDIRECTS = 3;
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export interface EmbedTarget {
  /** The provider-side id as validated ("550", "tt0137523", "slug"). */
  id: string;
  season?: number;
  episode?: number;
}

function isValidId(id: string, type: EmbedIdentifierType): boolean {
  switch (type) {
    case "tmdb":
      return TMDB_ID.test(id);
    case "imdb":
      return IMDB_ID.test(id);
    case "asset":
      return ASSET_ID.test(id) && !/^\.+$/.test(id);
  }
}

function parseNumber(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,5}$/.test(raw)) {
    return null;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** The movie/episode an association's asset id points at, or null when malformed. */
export function parseEmbedAssetId(
  raw: string,
  type: EmbedIdentifierType,
): EmbedTarget | null {
  const parts = raw.trim().split("/");

  if (parts.length === 1) {
    return isValidId(parts[0], type) ? { id: parts[0] } : null;
  }

  if (parts.length === 3) {
    const season = parseNumber(parts[1], 0, MAX_SEASON);
    const episode = parseNumber(parts[2], 1, MAX_EPISODE);

    return isValidId(parts[0], type) && season !== null && episode !== null
      ? { id: parts[0], season, episode }
      : null;
  }

  return null;
}

/** The asset id string for a target (inverse of parseEmbedAssetId). */
export function formatEmbedAssetId(target: EmbedTarget): string {
  return target.season === undefined
    ? target.id
    : `${target.id}/${target.season}/${target.episode}`;
}

/**
 * The iframe URL for a target, or an AdapterFailure. The only values that
 * reach the URL are the validated ones; the result is re-parsed and must keep
 * the configured https origin (and carry no credentials).
 */
export function buildEmbedUrl(
  config: EmbedServerConfig,
  target: EmbedTarget,
): string | AdapterFailure {
  const isEpisode = target.season !== undefined && target.episode !== undefined;
  const template = isEpisode ? config.episodeTemplate : config.movieTemplate;

  if (template === undefined) {
    return fail("Este provedor de player não tem endereço para episódios de séries.");
  }

  if (!isValidId(target.id, config.identifierType)) {
    return fail("Identificador do título inválido para este provedor.");
  }

  const values: Record<string, string> = {
    id: target.id,
    tmdbId: target.id,
    imdbId: target.id,
    season: String(target.season ?? ""),
    episode: String(target.episode ?? ""),
  };
  const path = template.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => values[name] ?? "");

  let url: URL;

  try {
    url = new URL(config.baseUrl + path);
  } catch {
    return fail("Não foi possível montar o endereço do player.");
  }

  if (
    url.protocol !== "https:" ||
    url.origin !== config.baseUrl ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return fail("O endereço do player montado saiu do domínio autorizado.");
  }

  return url.toString();
}

/** Why the provider's headers forbid MatchFlix from framing the page, or null. */
export function describeFramingProblem(headers: Headers): string | null {
  const frameOptions = headers.get("x-frame-options")?.trim().toLowerCase();

  if (frameOptions === "deny" || frameOptions === "sameorigin") {
    return "O provedor proíbe incorporar o player em outro site (X-Frame-Options).";
  }

  for (const policy of (headers.get("content-security-policy") ?? "").split(",")) {
    for (const directive of policy.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);

      if (name?.toLowerCase() !== "frame-ancestors") {
        continue;
      }

      const list = sources.map((source) => source.toLowerCase());

      if (list.length === 0 || list.every((source) => source === "'none'" || source === "'self'")) {
        return "O provedor proíbe incorporar o player em outro site (frame-ancestors).";
      }
    }
  }

  return null;
}

export interface EmbedAdapterOptions {
  config: EmbedServerConfig;
  /** Tests inject a fake; production uses the safe fetch (no private addresses). */
  fetchImpl?: typeof fetch;
}

const ASSET_HINTS: Record<EmbedIdentifierType, string> = {
  tmdb: 'ID do TMDB: filme "550"; episódio "1399/1/1" (série/temporada/episódio) — ou "auto" para derivar do título',
  imdb: 'ID do IMDb: filme "tt0137523"; episódio "tt0944947/1/1" (série/temporada/episódio) — ou "auto" (o IMDb ID vem do TMDB)',
  asset: 'ID do vídeo no provedor: filme "meu-filme"; episódio "minha-serie/1/1"',
};

export function createEmbedAdapter(options: EmbedAdapterOptions): PlaybackAdapter {
  const { config } = options;
  const fetchImpl =
    options.fetchImpl ?? createSafeFetch({ allowPrivateNetwork: config.allowPrivateNetwork });

  async function probe(url: string, signal: AbortSignal): Promise<AdapterFailure | null> {
    let current = url;

    for (let redirects = 0; ; redirects += 1) {
      let response: Response;

      try {
        response = await fetchImpl(current, {
          method: "GET",
          signal,
          redirect: "manual",
          headers: { Accept: "text/html,*/*;q=0.5" },
        });
      } catch {
        return fail(
          signal.aborted
            ? "O provedor do player não respondeu a tempo."
            : "Falha de rede ao consultar o provedor do player.",
        );
      }

      // Only the headers matter; never wait on (or buffer) the page body.
      void response.body?.cancel().catch(() => undefined);

      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get("location");
        let next: URL | null = null;

        try {
          next = location ? new URL(location, current) : null;
        } catch {
          next = null;
        }

        // A redirect may only stay on the authorized origin.
        if (redirects >= MAX_REDIRECTS || next === null || next.origin !== config.baseUrl) {
          return fail("O provedor do player redirecionou para fora do domínio autorizado.");
        }

        current = next.toString();
        continue;
      }

      if (response.status === 404 || response.status === 410) {
        return fail("O provedor do player não tem página para este título (HTTP " + response.status + ").");
      }

      if (!response.ok) {
        return fail(`O provedor do player respondeu HTTP ${response.status}.`);
      }

      const framing = describeFramingProblem(response.headers);

      return framing === null ? null : fail(framing);
    }
  }

  const details = [
    `Origem do player: ${config.baseUrl}`,
    `Identificador: ${config.identifierType}`,
    `Filme: ${config.movieTemplate}`,
    config.episodeTemplate !== undefined
      ? `Episódio: ${config.episodeTemplate}`
      : "Episódios: não suportados",
    config.sandbox ? "iframe com sandbox" : "iframe sem sandbox",
  ];

  return {
    id: config.id,
    label: config.label,
    assetIdHint: ASSET_HINTS[config.identifierType],
    licenseReference: config.licenseReference,
    descriptor: { kind: "embed", enabled: config.enabled, details },
    requiresImdbId: config.identifierType === "imdb",

    deriveAssetId(input) {
      if (config.identifierType === "asset") {
        return fail("Este provedor usa IDs próprios: informe o ID do vídeo no provedor.");
      }

      let id: string;

      if (config.identifierType === "tmdb") {
        id = String(input.tmdbId);
      } else if (input.imdbId !== undefined && IMDB_ID.test(input.imdbId)) {
        id = input.imdbId;
      } else {
        return fail(
          "O TMDB não tem IMDb ID para este título: este provedor não pode ser usado nele.",
        );
      }

      const target: EmbedTarget =
        input.mediaType === "EPISODE"
          ? { id, season: input.seasonNumber, episode: input.episodeNumber }
          : { id };

      return parseEmbedAssetId(formatEmbedAssetId(target), config.identifierType) === null
        ? fail("Não foi possível formar o identificador deste título.")
        : formatEmbedAssetId(target);
    },

    async resolve(assetId, resolveOptions): Promise<ResolvedAsset | AdapterFailure> {
      if (!config.enabled) {
        return fail("Este provedor de player está desativado na configuração.");
      }

      const target = parseEmbedAssetId(assetId, config.identifierType);

      if (target === null) {
        return fail("Identificador inválido para este provedor de player.");
      }

      const url = buildEmbedUrl(config, target);

      if (typeof url !== "string") {
        return url;
      }

      if (resolveOptions.purpose === "verify") {
        const problem = await probe(url, resolveOptions.signal);

        if (problem !== null) {
          return problem;
        }
      }

      return {
        type: "iframe",
        url,
        label: config.label,
        sandbox: config.sandbox,
        unconfirmed: true,
      };
    },
  };
}
