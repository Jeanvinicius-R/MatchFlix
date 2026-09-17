import type { ContentSummary } from "@/types/content.types";

/** Formats the secondary metadata line shown on cards and the hero banner. */
export function formatContentMeta(content: ContentSummary): string {
  const parts = [String(content.releaseYear), content.ageRating];

  if (content.type === "MOVIE" && content.durationInMinutes) {
    parts.push(formatRuntime(content.durationInMinutes));
  }

  if (content.type === "SERIES" && content.seasonCount) {
    parts.push(formatSeasonCount(content.seasonCount));
  }

  return parts.join(" • ");
}

export function formatRuntime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

export function formatSeasonCount(seasonCount: number): string {
  return seasonCount === 1 ? "1 temporada" : `${seasonCount} temporadas`;
}

/**
 * Deterministic gradient classes used while no real poster/backdrop
 * exists yet. Swapped for an actual image once the media pipeline lands.
 */
const PLACEHOLDER_GRADIENTS = [
  "from-slate-800 via-slate-900 to-black",
  "from-stone-800 via-neutral-900 to-black",
  "from-indigo-950 via-slate-900 to-black",
  "from-amber-950 via-neutral-900 to-black",
  "from-zinc-800 via-zinc-900 to-black",
] as const;

export function getPlaceholderGradientClass(seed: string): string {
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length];
}
