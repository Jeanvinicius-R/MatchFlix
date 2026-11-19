import type { AssociationMediaTypeValue } from "../../schemas/playback-association.schemas";
import {
  MIN_LICENSE_REFERENCE_LENGTH,
  type CandidateStatusValue,
  type MatchMethodValue,
} from "../../schemas/playback-candidate.schemas";
import {
  type AdapterFailure,
  type DiscoveryQuery,
  type PlaybackAdapter,
  type ProviderCandidate,
  type ProviderCatalogItem,
} from "./adapters/adapter.types";
import {
  UnknownProviderError,
  type AssociationView,
  type NewAssociation,
  type VerifyResult,
} from "./association.service-core";
import {
  MIN_STORED_SCORE,
  scoreCandidate,
  stripTrailingNoise,
  type MatchResult,
  type MatchableCandidate,
} from "./matching/matcher";

/**
 * Testable core of the discovery/approval flow. Three independent checks stay
 * separate on purpose:
 *
 *   1. MATCH      - is this provider item the TMDB title? (matcher + score)
 *   2. RIGHTS     - may we show it? Only an administrator decides, by approving
 *                   with the license/contract that applies (approveCandidates).
 *   3. AVAILABLE  - does the provider really deliver it? (verifyAssociation)
 *
 * A high score never proves rights, and the sync NEVER creates an association:
 * it only stores PENDING suggestions. Every dependency is injected, so tests run
 * with in-memory fakes. The default instance (Prisma + real adapters + TMDB) is
 * src/services/playback-candidate.service.ts.
 */

export interface CandidateView {
  id: string;
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  provider: string;
  providerAssetId: string;
  providerTitle: string;
  providerYear: number | null;
  matchMethod: MatchMethodValue;
  score: number;
  reason: string;
  status: CandidateStatusValue;
  createdAt: Date;
  decidedAt: Date | null;
}

/**
 * Only an identifier match (TMDB_ID = 100, IMDB_ID = 98) reaches this score, so only
 * those may be approved in a batch. A METADATA match (at most 89) needs an
 * individual approval with an explicit acknowledgement.
 */
export const BATCH_APPROVAL_MIN_SCORE = 95;

export interface NewCandidate {
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  provider: string;
  providerAssetId: string;
  providerTitle: string;
  providerYear: number | null;
  matchMethod: MatchMethodValue;
  score: number;
  reason: string;
}

export interface CandidateFilter {
  status?: CandidateStatusValue;
  provider?: string;
  minScore?: number;
  /** "strong" = identifier match (TMDB/IMDb), "metadata" = title/year only. */
  matchKind?: "strong" | "metadata";
  limit?: number;
}

/** A local catalog title (or episode) the sync asks a provider about. */
export interface ScanTitle {
  /** For an episode this is the id of the SERIES. */
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  /** pt-BR title (the series name for an episode). */
  title: string;
  originalTitle?: string;
  year?: number;
  runtimeMinutes?: number;
}

export interface CandidateRepository {
  /**
   * Idempotent. "existing" when an association or candidate for the asset is
   * already there; a decided (APPROVED/REJECTED) candidate is never reopened.
   */
  saveSuggestion(data: NewCandidate): Promise<"created" | "existing">;
  /** Highest score first, then newest. */
  list(filter: CandidateFilter): Promise<CandidateView[]>;
  findByIds(ids: string[]): Promise<CandidateView[]>;
  /** Moves PENDING candidates to a final status; returns how many changed. */
  markDecided(
    ids: string[],
    status: Exclude<CandidateStatusValue, "PENDING">,
    decidedAt: Date,
  ): Promise<number>;
  /** Local titles without an association or candidate for `provider`. */
  findTitlesToScan(input: { provider: string; limit: number }): Promise<ScanTitle[]>;
  /**
   * Provider asset ids that already have an association or a candidate (any
   * status), so a catalog sync can skip them without spending TMDB queries.
   */
  knownAssetIds(provider: string): Promise<Set<string>>;
}

/** What the sync needs from TMDB (the default instance wires tmdb.service). */
export interface TmdbSearchHit {
  tmdbId: number;
  title: string;
  originalTitle: string;
  releaseYear: number | null;
}

export interface TmdbPort {
  getMovieExternalIds(tmdbId: number): Promise<{ imdbId: string | null }>;
  getSeriesExternalIds(tmdbId: number): Promise<{ imdbId: string | null }>;
  findTmdbByImdbId(imdbId: string): Promise<{ movieId?: number; seriesId?: number }>;
  searchMovies(query: string): Promise<TmdbSearchHit[]>;
  searchSeries(query: string): Promise<TmdbSearchHit[]>;
}

/** The association-side operations the approval and the re-check need. */
export interface AssociationPort {
  /** Null when the (title, provider, asset) triple already exists. */
  create(data: NewAssociation): Promise<AssociationView | null>;
  /** Rights of the association already stored for this triple (null if none). */
  findRights(
    key: Pick<
      NewAssociation,
      | "tmdbId"
      | "mediaType"
      | "seasonNumber"
      | "episodeNumber"
      | "provider"
      | "providerAssetId"
    >,
  ): Promise<NewAssociation["rightsStatus"] | null>;
  verify(id: string): Promise<VerifyResult>;
  /** VERIFIED associations, never-checked and oldest first. */
  idsForReverification(options: {
    limit: number;
    includeUnavailable: boolean;
  }): Promise<string[]>;
}

export interface SyncLimits {
  /** Whole-run budget; the sync stops cleanly when it is spent. */
  timeBudgetMs: number;
  /** One provider call. */
  callTimeoutMs: number;
  maxCatalogPages: number;
  /** TMDB lookups (search / find) per run; cached ones are free. */
  maxTmdbQueries: number;
  defaultCatalogLimit: number;
  defaultTitlesLimit: number;
  maxLimit: number;
}

export const DEFAULT_SYNC_LIMITS: SyncLimits = {
  timeBudgetMs: 40_000,
  callTimeoutMs: 10_000,
  maxCatalogPages: 100,
  maxTmdbQueries: 40,
  defaultCatalogLimit: 100,
  defaultTitlesLimit: 25,
  maxLimit: 500,
};

export interface CandidateServiceDeps {
  repository: CandidateRepository;
  associations: AssociationPort;
  adapters: readonly PlaybackAdapter[];
  tmdb: TmdbPort;
  now?: () => Date;
  limits?: Partial<SyncLimits>;
}

export interface SyncReport {
  providerId: string;
  mode: "catalog" | "titles";
  scanned: number;
  created: number;
  skippedExisting: number;
  failures: string[];
  durationMs: number;
}

export interface ApproveInput {
  ids: string[];
  licenseReference: string;
  /** Required (true) to approve ONE weak, metadata-only suggestion. */
  acknowledgeMetadataMatch?: boolean;
  /** Required (true) when approving more than one candidate at once. */
  licenseCoversAllSelected?: boolean;
}

export interface ApproveResult {
  approved: number;
  /** Candidates whose association already existed (or that were already approved). */
  skipped: number;
  errors: string[];
}

export interface ReverifyInput {
  limit?: number;
  /** Default true: an UNAVAILABLE association must be able to recover. */
  includeUnavailable?: boolean;
}

export interface ReverifyResult {
  checked: number;
  available: number;
  unavailable: number;
}

const MAX_TMDB_SEARCH_HITS = 5;
const MAX_CANDIDATES_PER_TITLE = 5;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_FAILURES_REPORTED = 100;
const MAX_FIELD_LENGTH = 300;

/** Verifications right after an approval (best effort) and per re-check run. */
const POST_APPROVAL_VERIFY_LIMIT = 25;
const VERIFY_CONCURRENCY = 5;
const DEFAULT_REVERIFY_LIMIT = 25;
const MAX_REVERIFY_LIMIT = 100;

const TMDB_FAILURE = "Falha ao consultar a TMDB (confira TMDB_ACCESS_TOKEN e a rede).";

function isStrongMatch(candidate: Pick<CandidateView, "matchMethod" | "score">): boolean {
  return (
    candidate.matchMethod !== "METADATA" && candidate.score >= BATCH_APPROVAL_MIN_SCORE
  );
}

/** Adapter answers are either their payload or `{ reason }` (never both). */
function isFailure<T extends object>(result: T | AdapterFailure): result is AdapterFailure {
  return "reason" in result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}

/** Rejects once `ms` passed (the task keeps running but its result is dropped). */
function withDeadline<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });

  return Promise.race([task, expired]).finally(() => clearTimeout(timer));
}

async function inChunks<T>(
  items: readonly T[],
  size: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(task));
  }
}

function readTmdbId(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function readImdbId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^tt\d+$/.test(normalized) ? normalized : undefined;
}

/**
 * A discover() hit for an EPISODE query was searched for that very episode, so it
 * inherits the query's season/episode unless the provider states its own (the
 * matcher then still rejects a mismatch). A movie hit is used as is.
 */
function asMatchable(query: DiscoveryQuery, candidate: ProviderCandidate): MatchableCandidate {
  if (query.mediaType !== "EPISODE") {
    return candidate;
  }

  const carried: MatchableCandidate = candidate;

  return {
    ...candidate,
    mediaType: carried.mediaType ?? "EPISODE",
    seasonNumber: carried.seasonNumber ?? query.seasonNumber,
    episodeNumber: carried.episodeNumber ?? query.episodeNumber,
  };
}

/** A provider item as a stored suggestion, or null when its fields are unusable. */
function toNewCandidate(
  provider: string,
  query: DiscoveryQuery,
  candidate: ProviderCandidate,
  match: MatchResult,
): NewCandidate | null {
  const assetId = candidate.providerAssetId.trim();
  const title = candidate.title.trim();

  if (assetId === "" || assetId.length > MAX_FIELD_LENGTH || title === "") {
    return null;
  }

  const year = candidate.year;

  return {
    tmdbId: query.tmdbId,
    mediaType: query.mediaType,
    seasonNumber: query.mediaType === "MOVIE" ? 0 : query.seasonNumber,
    episodeNumber: query.mediaType === "MOVIE" ? 0 : query.episodeNumber,
    provider,
    providerAssetId: assetId,
    providerTitle: title.slice(0, MAX_FIELD_LENGTH),
    providerYear: typeof year === "number" && Number.isInteger(year) ? year : null,
    matchMethod: match.method,
    score: match.score,
    reason: match.reason,
  };
}

export function createCandidateService(deps: CandidateServiceDeps) {
  const { repository, associations, adapters, tmdb } = deps;
  const now = deps.now ?? (() => new Date());
  const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, ...deps.limits };

  function findAdapter(id: string): PlaybackAdapter | undefined {
    return adapters.find((adapter) => adapter.id === id);
  }

  /** Runs `verify` on each id, best effort: one failure never stops the others. */
  async function verifyAll(
    ids: readonly string[],
  ): Promise<{ checked: number; available: number; unavailable: number }> {
    const tally = { checked: 0, available: 0, unavailable: 0 };

    await inChunks(ids, VERIFY_CONCURRENCY, async (id) => {
      try {
        const result = await associations.verify(id);

        tally.checked += 1;

        if (result.availabilityStatus === "AVAILABLE") {
          tally.available += 1;
        } else {
          tally.unavailable += 1;
        }
      } catch {
        // Deleted meanwhile, or the store failed: not counted as checked.
      }
    });

    return tally;
  }

  async function syncProvider(input: {
    providerId: string;
    limit?: number;
  }): Promise<SyncReport> {
    const providerId = input.providerId.trim();
    const adapter = findAdapter(providerId);

    if (!adapter) {
      throw new UnknownProviderError(providerId || undefined);
    }

    const startedAt = now().getTime();
    const deadline = startedAt + limits.timeBudgetMs;
    const mode: SyncReport["mode"] = adapter.listCatalog ? "catalog" : "titles";
    const report: SyncReport = {
      providerId: adapter.id,
      mode,
      scanned: 0,
      created: 0,
      skippedExisting: 0,
      failures: [],
      durationMs: 0,
    };
    const seenFailures = new Set<string>();

    function fail(message: string): void {
      if (!seenFailures.has(message) && report.failures.length < MAX_FAILURES_REPORTED) {
        seenFailures.add(message);
        report.failures.push(message);
      }
    }

    function timeLeft(): number {
      return deadline - now().getTime();
    }

    /** A signal that ends at the call timeout or when the run budget does. */
    function callOptions(): { signal: AbortSignal } {
      return {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(limits.callTimeoutMs, timeLeft())),
        ),
      };
    }

    async function save(record: NewCandidate | null): Promise<void> {
      if (!record) {
        return;
      }

      const outcome = await repository.saveSuggestion(record);

      if (outcome === "created") {
        report.created += 1;
      } else {
        report.skippedExisting += 1;
      }
    }

    // ---- TMDB access with a per-run cache and a query budget -------------------

    let tmdbQueries = 0;
    const cache = new Map<string, unknown>();

    /** Cached lookups are free; a miss spends one query. Null when the budget is out. */
    async function tmdbCached<T>(key: string, load: () => Promise<T>): Promise<T | null> {
      if (cache.has(key)) {
        return cache.get(key) as T;
      }

      if (tmdbQueries >= limits.maxTmdbQueries) {
        return null;
      }

      tmdbQueries += 1;

      // The TMDB client takes no AbortSignal, so the call is raced against the
      // call timeout / run budget; a timeout throws and nothing is cached.
      const value = await withDeadline(
        load(),
        Math.max(1, Math.min(limits.callTimeoutMs, timeLeft())),
      );

      cache.set(key, value);
      return value;
    }

    async function syncCatalog(source: PlaybackAdapter, limit: number): Promise<void> {
      type Outcome =
        | { kind: "match"; query: DiscoveryQuery; match: MatchResult }
        | { kind: "none" }
        | { kind: "budget" };

      function catalogQuery(
        item: ProviderCatalogItem,
        tmdbId: number,
        imdbId: string | undefined,
        title: string,
        originalTitle?: string,
        year?: number,
      ): DiscoveryQuery | null {
        const isEpisode = item.mediaType === "EPISODE";
        const season = isEpisode ? item.seasonNumber : 0;
        const episode = isEpisode ? item.episodeNumber : 0;

        if (
          season === undefined ||
          episode === undefined ||
          !Number.isInteger(season) ||
          !Number.isInteger(episode) ||
          season < 0 ||
          episode < (isEpisode ? 1 : 0)
        ) {
          return null;
        }

        return {
          tmdbId,
          imdbId,
          mediaType: item.mediaType,
          seasonNumber: season,
          episodeNumber: episode,
          title,
          originalTitle,
          year,
        };
      }

      async function evaluate(item: ProviderCatalogItem): Promise<Outcome> {
        const isEpisode = item.mediaType === "EPISODE";
        const ownTitle = isEpisode ? (item.seriesTitle ?? item.title) : item.title;
        const declaredTmdb = readTmdbId(item.externalIds?.tmdb);
        const declaredImdb = readImdbId(item.externalIds?.imdb);

        // 1. The provider names the TMDB id itself (strongest evidence).
        if (declaredTmdb !== undefined) {
          const query = catalogQuery(
            item,
            declaredTmdb,
            declaredImdb,
            ownTitle,
            undefined,
            item.year,
          );
          const match = query ? scoreCandidate(query, item) : null;

          // The id is the provider's claim (panels often get it wrong, or give a
          // series id for a movie): it is not cross-checked, so say so.
          return query && match
            ? {
                kind: "match",
                query,
                match: {
                  ...match,
                  reason: `${match.reason} Id declarado pelo provedor, NÃO conferido com o título na TMDB: confira antes de aprovar.`,
                },
              }
            : { kind: "none" };
        }

        // 2. An IMDb id: TMDB tells which title it belongs to. When TMDB does not
        //    know it, the item is NOT matched by title instead (no way to compare).
        if (declaredImdb !== undefined) {
          const found = await tmdbCached(`find:${declaredImdb}`, () =>
            tmdb.findTmdbByImdbId(declaredImdb),
          );

          if (found === null) {
            return { kind: "budget" };
          }

          const tmdbId = isEpisode ? found.seriesId : found.movieId;
          const query =
            tmdbId === undefined
              ? null
              : catalogQuery(item, tmdbId, declaredImdb, ownTitle, undefined, item.year);
          const match = query ? scoreCandidate(query, item) : null;

          return query && match ? { kind: "match", query, match } : { kind: "none" };
        }

        // 3. Title + year against TMDB search results (weak evidence).
        // Tags like "(2000)" or "[HD]" would only produce false negatives.
        const searchTitle = stripTrailingNoise(ownTitle) || ownTitle.trim();
        const normalizedKey = `search:${item.mediaType}:${searchTitle.toLowerCase()}`;
        const hits = await tmdbCached(normalizedKey, () =>
          isEpisode ? tmdb.searchSeries(searchTitle) : tmdb.searchMovies(searchTitle),
        );

        if (hits === null) {
          return { kind: "budget" };
        }

        let best: { query: DiscoveryQuery; match: MatchResult } | null = null;
        let tie = false;

        for (const hit of hits.slice(0, MAX_TMDB_SEARCH_HITS)) {
          const query = catalogQuery(
            item,
            hit.tmdbId,
            undefined,
            hit.title,
            hit.originalTitle,
            hit.releaseYear ?? undefined,
          );
          const match = query ? scoreCandidate(query, item) : null;

          if (!query || !match || match.score < MIN_STORED_SCORE) {
            continue;
          }

          if (best === null || match.score > best.match.score) {
            best = { query, match };
            tie = false;
          } else if (match.score === best.match.score && query.tmdbId !== best.query.tmdbId) {
            tie = true;
          }
        }

        // Two different titles tie for the best score: ambiguous, so no suggestion.
        return best && !tie ? { kind: "match", ...best } : { kind: "none" };
      }

      if (!source.listCatalog) {
        return;
      }

      let cursor: string | undefined;
      let consecutiveTmdbFailures = 0;
      // Items that already have an association/candidate cost neither TMDB nor `limit`.
      const known = await repository.knownAssetIds(source.id);

      for (let page = 0; page < limits.maxCatalogPages; page += 1) {
        if (report.scanned >= limit) {
          break;
        }

        if (timeLeft() <= 0) {
          fail("Tempo da sincronização esgotado: rode de novo para continuar.");
          break;
        }

        const result = await source.listCatalog(cursor, callOptions());

        if (isFailure(result)) {
          fail(`Catálogo de ${source.label}: ${result.reason}`);
          return;
        }

        for (const item of result.items) {
          if (report.scanned >= limit) {
            return;
          }

          if (timeLeft() <= 0) {
            fail("Tempo da sincronização esgotado: rode de novo para continuar.");
            return;
          }

          if (known.has(item.providerAssetId.trim())) {
            report.skippedExisting += 1;
            continue;
          }

          let outcome: Outcome;

          try {
            outcome = await evaluate(item);
            consecutiveTmdbFailures = 0;
          } catch {
            fail(TMDB_FAILURE);
            consecutiveTmdbFailures += 1;

            if (consecutiveTmdbFailures >= MAX_CONSECUTIVE_FAILURES) {
              fail("Sincronização interrompida: a TMDB falhou várias vezes seguidas.");
              return;
            }

            continue;
          }

          if (outcome.kind === "budget") {
            fail(
              "Limite de consultas à TMDB desta execução atingido: rode a sincronização de novo para continuar.",
            );
            return;
          }

          report.scanned += 1;

          if (outcome.kind === "match" && outcome.match.score >= MIN_STORED_SCORE) {
            try {
              await save(toNewCandidate(source.id, outcome.query, item, outcome.match));
            } catch {
              fail("Falha ao gravar uma sugestão.");
            }
          }
        }

        if (result.nextCursor === undefined || result.nextCursor === cursor) {
          return;
        }

        cursor = result.nextCursor;
      }
    }

    async function syncTitles(source: PlaybackAdapter, limit: number): Promise<void> {
      if (!source.discover) {
        return;
      }

      const titles = await repository.findTitlesToScan({ provider: source.id, limit });
      let consecutiveFailures = 0;

      for (const title of titles) {
        if (timeLeft() <= 0) {
          fail("Tempo da sincronização esgotado: rode de novo para continuar.");
          return;
        }

        report.scanned += 1;

        // The IMDb id only improves the search; TMDB failing never aborts the title.
        let imdbId: string | undefined;

        try {
          const external = await tmdbCached(`ext:${title.mediaType}:${title.tmdbId}`, () =>
            title.mediaType === "MOVIE"
              ? tmdb.getMovieExternalIds(title.tmdbId)
              : tmdb.getSeriesExternalIds(title.tmdbId),
          );

          if (external === null) {
            fail(
              "Limite de consultas à TMDB atingido: os títulos seguintes foram buscados sem IMDb id.",
            );
          }

          imdbId = readImdbId(external?.imdbId ?? undefined);
        } catch {
          imdbId = undefined;
        }

        const query: DiscoveryQuery = {
          tmdbId: title.tmdbId,
          imdbId,
          mediaType: title.mediaType,
          seasonNumber: title.mediaType === "MOVIE" ? 0 : title.seasonNumber,
          episodeNumber: title.mediaType === "MOVIE" ? 0 : title.episodeNumber,
          title: title.title,
          originalTitle: title.originalTitle,
          year: title.year,
          runtimeMinutes: title.runtimeMinutes,
        };

        let found: ProviderCandidate[] | AdapterFailure;

        try {
          found = await source.discover(query, callOptions());
        } catch {
          found = { reason: "Falha ao consultar o provedor." };
        }

        if (isFailure(found)) {
          fail(`${source.label}: ${found.reason}`);
          consecutiveFailures += 1;

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            fail("Sincronização interrompida: o provedor falhou várias vezes seguidas.");
            return;
          }

          continue;
        }

        consecutiveFailures = 0;

        const scored: { candidate: ProviderCandidate; match: MatchResult }[] = [];

        for (const candidate of found) {
          const match = scoreCandidate(query, asMatchable(query, candidate));

          if (match && match.score >= MIN_STORED_SCORE) {
            scored.push({ candidate, match });
          }
        }

        scored.sort((a, b) => b.match.score - a.match.score);

        for (const { candidate, match } of scored.slice(0, MAX_CANDIDATES_PER_TITLE)) {
          try {
            await save(toNewCandidate(source.id, query, candidate, match));
          } catch {
            fail("Falha ao gravar uma sugestão.");
          }
        }
      }
    }

    try {
      if (adapter.listCatalog) {
        await syncCatalog(
          adapter,
          clamp(input.limit ?? limits.defaultCatalogLimit, 1, limits.maxLimit),
        );
      } else if (adapter.discover) {
        await syncTitles(
          adapter,
          clamp(input.limit ?? limits.defaultTitlesLimit, 1, limits.maxLimit),
        );
      } else {
        fail("Este provedor não oferece sincronização automática.");
      }
    } catch {
      // A provider/store failure is a result, never an exception.
      fail("A sincronização foi interrompida por uma falha inesperada.");
    }

    report.durationMs = Math.max(0, now().getTime() - startedAt);
    return report;
  }

  return {
    listCandidates(filter: CandidateFilter = {}): Promise<CandidateView[]> {
      return repository.list(filter);
    },

    syncProvider,

    /**
     * The ONLY place a suggestion becomes playable, and only with a license the
     * administrator typed. Never throws for rule violations: they come back in
     * `errors` and nothing is approved.
     *   - one candidate: any score, but a weak (METADATA or < 95) one needs
     *     acknowledgeMetadataMatch === true;
     *   - several: licenseCoversAllSelected must be true, all from ONE provider,
     *     and only identifier matches (score >= 95) are approved; weak ones are
     *     reported in `errors` and left PENDING;
     *   - idempotent: an existing association counts as skipped.
     * Afterwards the new associations are checked against the provider (up to 25,
     * best effort) so the availability state is real from the start.
     */
    async approveCandidates(input: ApproveInput): Promise<ApproveResult> {
      const result: ApproveResult = { approved: 0, skipped: 0, errors: [] };
      const ids = Array.from(new Set(input.ids));
      const licenseReference = input.licenseReference.trim();

      if (ids.length === 0) {
        result.errors.push("Selecione ao menos um candidato.");
        return result;
      }

      if (licenseReference.length < MIN_LICENSE_REFERENCE_LENGTH) {
        result.errors.push(
          `Informe a licença ou o contrato que autoriza a exibição (mínimo de ${MIN_LICENSE_REFERENCE_LENGTH} caracteres).`,
        );
        return result;
      }

      const batch = ids.length > 1;

      if (batch && input.licenseCoversAllSelected !== true) {
        result.errors.push(
          `Confirme que esta licença/contrato abrange TODOS os ${ids.length} títulos selecionados.`,
        );
        return result;
      }

      const found = await repository.findByIds(ids);
      const byId = new Map(found.map((candidate) => [candidate.id, candidate]));

      for (const id of ids) {
        if (!byId.has(id)) {
          result.errors.push(`Candidato não encontrado (${id}).`);
        }
      }

      if (batch && new Set(found.map((candidate) => candidate.provider)).size > 1) {
        result.errors.push(
          "A aprovação em lote precisa ser de um único provedor: uma licença não pode abranger provedores diferentes.",
        );
        return result;
      }

      const createdAssociations: string[] = [];

      for (const id of ids) {
        const candidate = byId.get(id);

        if (!candidate) {
          continue;
        }

        const label = `"${candidate.providerTitle}" (${candidate.provider})`;

        if (candidate.status === "APPROVED") {
          result.skipped += 1;
          continue;
        }

        if (candidate.status === "REJECTED") {
          result.errors.push(`${label} já foi rejeitado.`);
          continue;
        }

        if (!isStrongMatch(candidate)) {
          if (batch) {
            result.errors.push(
              `${label}: correspondência por título/ano só pode ser aprovada individualmente.`,
            );
            continue;
          }

          if (input.acknowledgeMetadataMatch !== true) {
            result.errors.push(
              `${label}: a correspondência é só por título/ano. Confirme que conferiu que é o mesmo título para aprovar.`,
            );
            continue;
          }
        }

        if (!findAdapter(candidate.provider)) {
          result.errors.push(`${label}: provedor desconhecido.`);
          continue;
        }

        try {
          const created = await associations.create({
            tmdbId: candidate.tmdbId,
            mediaType: candidate.mediaType,
            seasonNumber: candidate.seasonNumber,
            episodeNumber: candidate.episodeNumber,
            provider: candidate.provider,
            providerAssetId: candidate.providerAssetId,
            playbackType: null,
            rightsStatus: "VERIFIED",
            licenseReference,
          });

          if (!created) {
            // The triple was already registered. Take the candidate out of the
            // queue either way; a non-VERIFIED association stays as the admin left
            // it (an approval never overrides a revocation), and we say so.
            const rights = await associations.findRights(candidate);

            result.skipped += 1;

            if (rights !== null && rights !== "VERIFIED") {
              result.errors.push(
                `${label}: já existe associação com direitos ${rights}; ajuste-os em Reprodução.`,
              );
              await repository.markDecided([candidate.id], "REJECTED", now());
            } else {
              await repository.markDecided([candidate.id], "APPROVED", now());
            }

            continue;
          }

          result.approved += 1;
          createdAssociations.push(created.id);
          await repository.markDecided([candidate.id], "APPROVED", now());
        } catch {
          result.errors.push(`${label}: falha ao registrar a aprovação.`);
        }
      }

      if (createdAssociations.length > 0) {
        await verifyAll(createdAssociations.slice(0, POST_APPROVAL_VERIFY_LIMIT));
      }

      return result;
    },

    /** Only PENDING candidates are rejected; returns how many were. */
    async rejectCandidates(ids: string[]): Promise<number> {
      const unique = Array.from(new Set(ids));

      if (unique.length === 0) {
        return 0;
      }

      return repository.markDecided(unique, "REJECTED", now());
    },

    /**
     * Re-checks VERIFIED associations against their provider, never-checked and
     * oldest first, UNAVAILABLE ones included by default so they can recover.
     */
    async reverifyAssociations(input: ReverifyInput = {}): Promise<ReverifyResult> {
      const limit = clamp(input.limit ?? DEFAULT_REVERIFY_LIMIT, 1, MAX_REVERIFY_LIMIT);
      const ids = await associations.idsForReverification({
        limit,
        includeUnavailable: input.includeUnavailable ?? true,
      });

      return verifyAll(ids);
    },
  };
}

export type CandidateService = ReturnType<typeof createCandidateService>;
