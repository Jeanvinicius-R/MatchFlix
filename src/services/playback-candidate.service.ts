import {
  createAssociationRecord,
  findAssociationIdsForReverification,
} from "@/repositories/playback-association.repository";
import {
  findCandidates,
  findCandidatesByIds,
  findCatalogTitlesToScan,
  markCandidatesDecided,
  saveCandidateSuggestion,
} from "@/repositories/playback-candidate.repository";
import { verifyAssociation } from "@/services/playback-association.service";
import { adapters } from "@/services/playback/adapters/registry";
import {
  createCandidateService,
  type CandidateRepository,
  type TmdbPort,
} from "@/services/playback/candidate.service-core";
import {
  findTmdbByImdbId,
  getMovieExternalIds,
  getSeriesExternalIds,
  searchMovies,
  searchSeries,
} from "@/services/tmdb/tmdb.service";

/**
 * Default candidate service: Prisma repositories + the real adapter registry +
 * the TMDB service. The logic (and its tests) live in
 * playback/candidate.service-core.ts. Nothing here makes anything playable:
 * suggestions only become associations through approveCandidates.
 */

export {
  BATCH_APPROVAL_MIN_SCORE,
  type CandidateView,
  type SyncReport,
} from "@/services/playback/candidate.service-core";

const repository: CandidateRepository = {
  saveSuggestion: saveCandidateSuggestion,
  list: findCandidates,
  findByIds: findCandidatesByIds,
  markDecided: markCandidatesDecided,
  findTitlesToScan: findCatalogTitlesToScan,
};

const tmdb: TmdbPort = {
  getMovieExternalIds,
  getSeriesExternalIds,
  findTmdbByImdbId,
  searchMovies,
  searchSeries,
};

const service = createCandidateService({
  repository,
  associations: {
    create: createAssociationRecord,
    verify: verifyAssociation,
    idsForReverification: findAssociationIdsForReverification,
  },
  adapters,
  tmdb,
});

export const {
  listCandidates,
  approveCandidates,
  rejectCandidates,
  syncProvider,
  reverifyAssociations,
} = service;
