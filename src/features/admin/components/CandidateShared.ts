import {
  computeAvailabilityState,
  parseFreshHours,
  type AvailabilityRecord,
  type AvailabilityState,
} from "@/services/playback/availability-state";
import type { CandidateView } from "@/services/playback/candidate.service-core";

/** What the candidate screens need to know about a provider (serializable). */
export interface CandidateAdapterOption {
  id: string;
  label: string;
  canDiscover: boolean;
  canListCatalog: boolean;
  /** Provider-level contract/licence; only PRE-FILLS the approval field. */
  suggestedLicenseReference?: string;
}

export type CandidateMethod = CandidateView["matchMethod"];

export const MATCH_METHOD_LABELS: Record<CandidateMethod, string> = {
  TMDB_ID: "ID forte (TMDB)",
  IMDB_ID: "ID forte (IMDb)",
  METADATA: "Metadados (título/ano)",
};

/** Minimum characters of a licence reference (mirrors the service rule). */
export const MIN_LICENSE_LENGTH = 10;

/** Only an identifier match with a high score may be approved in a batch. */
export function isBatchEligible(
  candidate: Pick<CandidateView, "matchMethod" | "score">,
  batchMinScore: number,
): boolean {
  return candidate.matchMethod !== "METADATA" && candidate.score >= batchMinScore;
}

/**
 * What a viewer can get for ONE association, as the admin sees it. The rules live
 * in services/playback/availability-state.ts (the same ones the cards and the API
 * use); this only adds the Portuguese hint. A database row alone never means
 * "available": only a fresh AVAILABLE check does.
 */
export type AssociationAvailabilityState = AvailabilityState;

export { parseFreshHours };

export interface AssociationAvailabilityResult {
  state: AssociationAvailabilityState;
  /** Short Portuguese hint explaining the state (shown under the badge). */
  note: string;
}

export function describeAssociationAvailability(
  association: AvailabilityRecord,
  nowMs: number,
  freshHours: number,
): AssociationAvailabilityResult {
  const state = computeAvailabilityState([association], nowMs, freshHours);

  switch (state) {
    case "NONE":
      return { state, note: "Direitos não verificados: não é exibido." };
    case "UNAVAILABLE":
      return { state, note: "Provedor não entrega o vídeo." };
    case "CONFIRMED":
      return { state, note: "Verificada recentemente no provedor." };
    case "UNKNOWN":
      if (association.availabilityStatus === "AVAILABLE" && association.lastVerifiedAt) {
        return { state, note: `Verificação fora da janela de ${freshHours} h.` };
      }
      return {
        state,
        note: association.lastVerifiedAt
          ? "Status desconhecido: verifique."
          : "Nunca verificada: verifique.",
      };
  }
}

/** Link to the title on TMDB (an episode points to its series). */
export function tmdbTitleUrl(candidate: Pick<CandidateView, "tmdbId" | "mediaType">) {
  const kind = candidate.mediaType === "MOVIE" ? "movie" : "tv";
  return `https://www.themoviedb.org/${kind}/${candidate.tmdbId}`;
}
