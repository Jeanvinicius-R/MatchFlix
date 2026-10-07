import { isAuthorizedProviderEnabled } from "./providers/authorized.provider";
import { findCuratedArchiveMovie } from "./providers/internet-archive.provider";

/**
 * Whether a title is known to be playable through the PlaybackResolver
 * without asking any external API: the authorized source (when configured)
 * answers for every TMDB id, and the Internet Archive list is static.
 * YouTube is deliberately left out — knowing would cost API quota per card.
 */
export function hasKnownPlaybackSource(
  tmdbId: number | null,
  kind: "movie" | "series",
): boolean {
  if (!tmdbId) {
    return false;
  }
  if (isAuthorizedProviderEnabled()) {
    return true;
  }
  return kind === "movie" && findCuratedArchiveMovie(tmdbId) !== null;
}
