import {
  createAssociationRecord,
  findAssociationIdsForReverification,
  findAssociationRights,
} from "@/repositories/playback-association.repository";
import {
  findCandidates,
  findCandidatesByIds,
  findCatalogTitlesToScan,
  findKnownAssetIds,
  markCandidatesDecided,
  saveCandidateSuggestion,
} from "@/repositories/playback-candidate.repository";
import { verifyAssociation } from "@/services/playback-association.service";
import { adapters } from "@/services/playback/adapters/registry";
import { invalidatingPlayable } from "@/services/playback/playable-titles.default";
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
  knownAssetIds: findKnownAssetIds,
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
    findRights: findAssociationRights,
    verify: verifyAssociation,
    idsForReverification: findAssociationIdsForReverification,
  },
  adapters,
  tmdb,
});

export const { listCandidates, rejectCandidates, syncProvider } = service;

// An approval creates associations and a re-check changes availability: the card
// badges must reflect both right away.
export const approveCandidates = invalidatingPlayable(service.approveCandidates);
export const reverifyAssociations = invalidatingPlayable(service.reverifyAssociations);
