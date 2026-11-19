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
 * What a viewer can get for ONE association, as the admin sees it. A database row
 * alone never means "available": only a fresh AVAILABLE check does.
 */
export type AssociationAvailabilityState = "NONE" | "CONFIRMED" | "UNKNOWN" | "UNAVAILABLE";

export interface AssociationAvailabilityResult {
  state: AssociationAvailabilityState;
  /** Short Portuguese hint explaining the state (shown under the badge). */
  note: string;
}

/** Same default window as PLAYBACK_AVAILABILITY_FRESH_HOURS (48 h). */
export const DEFAULT_FRESH_HOURS = 48;

/** Reads the freshness window (hours) from a raw env value; invalid => default. */
export function parseFreshHours(raw: string | undefined): number {
  const value = Number(raw);
  return raw && Number.isFinite(value) && value > 0 ? value : DEFAULT_FRESH_HOURS;
}

/**
 * Per-association state: NONE (rights not VERIFIED), CONFIRMED (AVAILABLE and checked
 * within the window), UNKNOWN (never checked, status unknown or stale) or UNAVAILABLE.
 */
export function describeAssociationAvailability(
  association: {
    rightsStatus: string;
    availabilityStatus: string;
    lastVerifiedAt: Date | null;
  },
  nowMs: number,
  freshHours: number,
): AssociationAvailabilityResult {
  if (association.rightsStatus !== "VERIFIED") {
    return { state: "NONE", note: "Direitos não verificados: não é exibido." };
  }
  if (association.availabilityStatus === "UNAVAILABLE") {
    return { state: "UNAVAILABLE", note: "Provedor não entrega o vídeo." };
  }
  if (association.availabilityStatus !== "AVAILABLE" || !association.lastVerifiedAt) {
    return {
      state: "UNKNOWN",
      note: association.lastVerifiedAt
        ? "Status desconhecido: verifique."
        : "Nunca verificada: verifique.",
    };
  }
  const ageMs = nowMs - association.lastVerifiedAt.getTime();
  if (ageMs > freshHours * 60 * 60 * 1000) {
    return { state: "UNKNOWN", note: `Verificação com mais de ${freshHours} h.` };
  }
  return { state: "CONFIRMED", note: "Verificada recentemente no provedor." };
}

/** Link to the title on TMDB (an episode points to its series). */
export function tmdbTitleUrl(candidate: Pick<CandidateView, "tmdbId" | "mediaType">) {
  const kind = candidate.mediaType === "MOVIE" ? "movie" : "tv";
  return `https://www.themoviedb.org/${kind}/${candidate.tmdbId}`;
}
