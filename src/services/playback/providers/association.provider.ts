import { isAdapterFailure, type PlaybackAdapter } from "../adapters/adapter.types";
import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";
import { buildProxyUrl, mintProxyToken } from "../proxy/proxy-token";
import { describeSourceProblem, sanitizeSource } from "../source-guard";

/**
 * Association-backed provider: one instance per adapter. It plays only what an
 * administrator explicitly tied to a TMDB title (PlaybackAssociation) AND marked
 * as VERIFIED, then asks the adapter — which re-checks the license at the source —
 * for the actual media. Everything else fails closed to null:
 *
 *   - no association, or UNVERIFIED / EXPIRED / REVOKED rights => never touched;
 *   - availability UNAVAILABLE (last check failed) => skipped;
 *   - adapter refuses, throws, times out or returns an unsafe URL => skipped.
 *
 * Media the browser must not contact directly (the adapter answers with `proxy`)
 * becomes an encrypted same-origin `/api/playback/proxy/<token>` URL bound to
 * the signed-in user; without a user (or without AUTH_SECRET) it is skipped.
 */

export interface AssociationCandidateQuery {
  tmdbId: number;
  mediaType: "MOVIE" | "EPISODE";
  seasonNumber: number;
  episodeNumber: number;
  /** Adapter id. */
  provider: string;
}

export interface AssociationCandidate {
  id: string;
  providerAssetId: string;
  rightsStatus: string;
  availabilityStatus: string;
}

/** The slice of the repository this provider needs (injected in tests). */
export interface AssociationCandidateRepository {
  findPlayableCandidates(query: AssociationCandidateQuery): Promise<AssociationCandidate[]>;
}

export interface AssociationProviderOptions {
  adapter: PlaybackAdapter;
  repository: AssociationCandidateRepository;
  /** Per adapter call; below the resolver's own 5 s so the signal fires first. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;

/** Several associations for one title are rare; never fan out to many remote calls. */
const MAX_CANDIDATES = 3;

export function createAssociationProvider(
  options: AssociationProviderOptions,
): PlaybackProvider {
  const { adapter, repository, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  async function resolveCandidates(
    query: AssociationCandidateQuery,
    viewerId: string | undefined,
  ): Promise<PlaybackSource | null> {
    let candidates: AssociationCandidate[];

    try {
      candidates = await repository.findPlayableCandidates(query);
    } catch (error) {
      console.warn(`Playback "${adapter.id}": associações indisponíveis.`, error);
      return null;
    }

    // The repository already filters, but the rule is enforced here too:
    // only an explicit VERIFIED may reach the adapter.
    const playable = candidates
      .filter(
        (candidate) =>
          candidate.rightsStatus === "VERIFIED" &&
          candidate.availabilityStatus !== "UNAVAILABLE",
      )
      .slice(0, MAX_CANDIDATES);

    for (const candidate of playable) {
      try {
        const result = await adapter.resolve(candidate.providerAssetId, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (isAdapterFailure(result)) {
          console.warn(
            `Playback "${adapter.id}": fonte recusada (${candidate.id}):`,
            result.reason,
          );
          continue;
        }

        let url: string;

        if (result.proxy !== undefined) {
          // Media the browser must not contact: serve it through the encrypted,
          // per-user proxy token. Without a signed-in user there is no token.
          if (!viewerId) {
            console.warn(
              `Playback "${adapter.id}": fonte protegida sem usuário (${candidate.id}).`,
            );
            continue;
          }

          try {
            url = buildProxyUrl(
              mintProxyToken({
                upstreamUrl: result.proxy.upstreamUrl,
                headers: result.proxy.headers,
                allowedOrigins: result.proxy.allowedOrigins,
                userId: viewerId,
              }),
            );
          } catch (error) {
            // The message never carries the upstream URL or any credential.
            console.warn(
              `Playback "${adapter.id}": proxy indisponível (${candidate.id}):`,
              error instanceof Error ? error.message : "erro desconhecido",
            );
            continue;
          }
        } else {
          url = result.url;
        }

        const source: PlaybackSource = {
          id: `${adapter.id}-${candidate.id}`,
          provider: adapter.id,
          type: result.type,
          url,
          label: result.label ?? adapter.label,
        };

        if (result.mimeType !== undefined) {
          source.mimeType = result.mimeType;
        }

        if (result.qualities !== undefined) {
          source.qualities = result.qualities;
        }

        if (result.subtitles !== undefined) {
          source.subtitles = result.subtitles;
        }

        if (result.attribution !== undefined) {
          source.attribution = result.attribution;
        }

        const safe = sanitizeSource(source);

        if (safe) {
          return safe;
        }

        console.warn(
          `Playback "${adapter.id}": fonte descartada (${candidate.id}):`,
          describeSourceProblem(source),
        );
      } catch (error) {
        console.warn(`Playback "${adapter.id}": falha ao resolver (${candidate.id}).`, error);
      }
    }

    return null;
  }

  return {
    id: adapter.id,
    label: adapter.label,

    getMovieSource(context: PlaybackContext) {
      if (!Number.isInteger(context.tmdbId) || context.tmdbId <= 0) {
        return Promise.resolve(null);
      }

      return resolveCandidates(
        {
          tmdbId: context.tmdbId,
          mediaType: "MOVIE",
          seasonNumber: 0,
          episodeNumber: 0,
          provider: adapter.id,
        },
        context.viewerId,
      );
    },

    getEpisodeSource(context: PlaybackContext) {
      const { tmdbId, season, episode } = context;

      if (
        !Number.isInteger(tmdbId) ||
        tmdbId <= 0 ||
        season === undefined ||
        episode === undefined ||
        !Number.isInteger(season) ||
        season < 0 ||
        !Number.isInteger(episode) ||
        episode < 1
      ) {
        return Promise.resolve(null);
      }

      return resolveCandidates(
        {
          tmdbId,
          mediaType: "EPISODE",
          seasonNumber: season,
          episodeNumber: episode,
          provider: adapter.id,
        },
        context.viewerId,
      );
    },
  };
}
