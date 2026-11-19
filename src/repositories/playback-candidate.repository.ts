import { prisma } from "@/lib/prisma";
import type { AssociationMediaTypeValue } from "@/schemas/playback-association.schemas";
import type {
  CandidateStatusValue,
  MatchMethodValue,
} from "@/schemas/playback-candidate.schemas";

const CANDIDATE_SELECT = {
  id: true,
  tmdbId: true,
  mediaType: true,
  seasonNumber: true,
  episodeNumber: true,
  provider: true,
  providerAssetId: true,
  providerTitle: true,
  providerYear: true,
  matchMethod: true,
  score: true,
  reason: true,
  status: true,
  createdAt: true,
  decidedAt: true,
} as const;

/** Most rows one listing returns, whatever the caller asks for. */
const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 200;

export interface NewCandidateRecord {
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

export interface CandidateListFilter {
  status?: CandidateStatusValue;
  provider?: string;
  minScore?: number;
  /** "strong" = identifier match, "metadata" = title/year only (applied before the limit). */
  matchKind?: "strong" | "metadata";
  limit?: number;
}

/** A local catalog title (or episode) the sync asks a provider about. */
export interface ScanTitleRecord {
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

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as { code?: string } | null)?.code === code;
}

/**
 * Stores a suggestion without ever undoing a decision:
 *   - an association for the same asset already exists   -> "existing", nothing written;
 *   - the candidate is new                               -> created PENDING;
 *   - the candidate exists                               -> only a PENDING one is refreshed
 *     (an APPROVED/REJECTED candidate is never reopened or edited).
 */
export async function saveCandidateSuggestion(
  data: NewCandidateRecord,
): Promise<"created" | "existing"> {
  const key = {
    tmdbId: data.tmdbId,
    mediaType: data.mediaType,
    seasonNumber: data.seasonNumber,
    episodeNumber: data.episodeNumber,
    provider: data.provider,
    providerAssetId: data.providerAssetId,
  };
  const association = await prisma.playbackAssociation.findFirst({
    where: key,
    select: { id: true },
  });

  if (association) {
    return "existing";
  }

  try {
    await prisma.playbackCandidate.create({ data, select: { id: true } });
    return "created";
  } catch (error) {
    if (!hasErrorCode(error, "P2002")) {
      throw error;
    }

    await prisma.playbackCandidate.updateMany({
      where: { ...key, status: "PENDING" },
      data: {
        providerTitle: data.providerTitle,
        providerYear: data.providerYear,
        matchMethod: data.matchMethod,
        score: data.score,
        reason: data.reason,
      },
    });

    return "existing";
  }
}

/** Highest score first, then the newest. */
export function findCandidates(filter: CandidateListFilter = {}) {
  return prisma.playbackCandidate.findMany({
    where: {
      status: filter.status,
      provider: filter.provider,
      score: filter.minScore === undefined ? undefined : { gte: filter.minScore },
      matchMethod:
        filter.matchKind === "metadata"
          ? "METADATA"
          : filter.matchKind === "strong"
            ? { not: "METADATA" }
            : undefined,
    },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT),
    select: CANDIDATE_SELECT,
  });
}

export function findCandidatesByIds(ids: string[]) {
  return prisma.playbackCandidate.findMany({
    where: { id: { in: ids } },
    select: CANDIDATE_SELECT,
  });
}

/** Moves PENDING candidates to a final status; returns how many changed. */
export async function markCandidatesDecided(
  ids: string[],
  status: Exclude<CandidateStatusValue, "PENDING">,
  decidedAt: Date,
): Promise<number> {
  const result = await prisma.playbackCandidate.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status, decidedAt },
  });

  return result.count;
}

/** A start position that spreads repeated scans over a large catalog. */
function randomOffset(total: number, window: number): number {
  return total > window ? Math.floor(Math.random() * (total - window + 1)) : 0;
}

async function findMovieTitlesToScan(
  provider: string,
  limit: number,
): Promise<ScanTitleRecord[]> {
  const [associations, candidates] = await Promise.all([
    prisma.playbackAssociation.findMany({
      where: { provider, mediaType: "MOVIE" },
      distinct: ["tmdbId"],
      select: { tmdbId: true },
    }),
    prisma.playbackCandidate.findMany({
      where: { provider, mediaType: "MOVIE" },
      distinct: ["tmdbId"],
      select: { tmdbId: true },
    }),
  ]);
  const known = Array.from(
    new Set([...associations, ...candidates].map((row) => row.tmdbId)),
  );
  const where = {
    isActive: true,
    tmdbId: { not: null, notIn: known },
  };
  const total = await prisma.movie.count({ where });
  const movies = await prisma.movie.findMany({
    where,
    orderBy: { id: "asc" },
    skip: randomOffset(total, limit),
    take: limit,
    select: {
      tmdbId: true,
      title: true,
      originalTitle: true,
      releaseYear: true,
      durationInMinutes: true,
    },
  });
  const titles: ScanTitleRecord[] = [];

  for (const movie of movies) {
    if (movie.tmdbId === null) {
      continue;
    }

    titles.push({
      tmdbId: movie.tmdbId,
      mediaType: "MOVIE",
      seasonNumber: 0,
      episodeNumber: 0,
      title: movie.title,
      originalTitle: movie.originalTitle ?? undefined,
      year: movie.releaseYear,
      runtimeMinutes: movie.durationInMinutes,
    });
  }

  return titles;
}

async function findEpisodeTitlesToScan(
  provider: string,
  limit: number,
): Promise<ScanTitleRecord[]> {
  const where = {
    episodeNumber: { gte: 1 },
    season: { series: { isActive: true, tmdbId: { not: null } } },
  };
  const [associations, candidates, total] = await Promise.all([
    prisma.playbackAssociation.findMany({
      where: { provider, mediaType: "EPISODE" },
      select: { tmdbId: true, seasonNumber: true, episodeNumber: true },
    }),
    prisma.playbackCandidate.findMany({
      where: { provider, mediaType: "EPISODE" },
      select: { tmdbId: true, seasonNumber: true, episodeNumber: true },
    }),
    prisma.episode.count({ where }),
  ]);
  const known = new Set(
    [...associations, ...candidates].map(
      (row) => `${row.tmdbId}|${row.seasonNumber}|${row.episodeNumber}`,
    ),
  );
  // Over-fetch: some rows are dropped below because they are already known.
  const window = limit * 4;
  const episodes = await prisma.episode.findMany({
    where,
    orderBy: { id: "asc" },
    skip: randomOffset(total, window),
    take: window,
    select: {
      episodeNumber: true,
      durationInMinutes: true,
      season: {
        select: {
          seasonNumber: true,
          series: {
            select: { tmdbId: true, title: true, originalTitle: true, releaseYear: true },
          },
        },
      },
    },
  });
  const titles: ScanTitleRecord[] = [];

  for (const episode of episodes) {
    const { series, seasonNumber } = episode.season;

    if (
      series.tmdbId === null ||
      known.has(`${series.tmdbId}|${seasonNumber}|${episode.episodeNumber}`)
    ) {
      continue;
    }

    titles.push({
      tmdbId: series.tmdbId,
      mediaType: "EPISODE",
      seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: series.title,
      originalTitle: series.originalTitle ?? undefined,
      year: series.releaseYear,
      runtimeMinutes: episode.durationInMinutes ?? undefined,
    });

    if (titles.length >= limit) {
      break;
    }
  }

  return titles;
}

/**
 * Active local movies (then episodes of local series) with a tmdbId that have
 * neither an association nor a candidate for `provider` yet. Movies come first.
 */
export async function findCatalogTitlesToScan(input: {
  provider: string;
  limit: number;
}): Promise<ScanTitleRecord[]> {
  const movies = await findMovieTitlesToScan(input.provider, input.limit);
  const remaining = input.limit - movies.length;

  if (remaining <= 0) {
    return movies;
  }

  return [...movies, ...(await findEpisodeTitlesToScan(input.provider, remaining))];
}

/**
 * Asset ids of `provider` that already have an association or a candidate (any
 * status), so a catalog sync never spends TMDB queries on them again.
 */
export async function findKnownAssetIds(provider: string): Promise<Set<string>> {
  const [associations, candidates] = await Promise.all([
    prisma.playbackAssociation.findMany({
      where: { provider },
      select: { providerAssetId: true },
    }),
    prisma.playbackCandidate.findMany({
      where: { provider },
      select: { providerAssetId: true },
    }),
  ]);

  return new Set(
    [...associations, ...candidates].map((row) => row.providerAssetId),
  );
}
