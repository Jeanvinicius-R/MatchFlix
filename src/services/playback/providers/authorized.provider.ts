import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";

/**
 * Generic provider for a video source the site owner is authorized to use.
 * It only builds URLs from PLAYBACK_AUTHORIZED_BASE_URL; it never makes
 * requests, searches, or discovers anything on its own.
 *
 *   movie:   ${base}/movie/${tmdbId}
 *   episode: ${base}/tv/${tmdbId}/${season}/${episode}
 */

/**
 * Base URL without trailing slashes, or null when the env var is empty or not
 * an http(s) URL (so values like "javascript:" or "data:" never reach an iframe).
 */
function getBaseUrl(): string | null {
  const raw = process.env.PLAYBACK_AUTHORIZED_BASE_URL?.trim();

  if (!raw) {
    return null;
  }

  try {
    const { protocol } = new URL(raw);

    if (protocol !== "https:" && protocol !== "http:") {
      return null;
    }
  } catch {
    return null;
  }

  return raw.replace(/\/+$/, "");
}

export const authorizedProvider: PlaybackProvider = {
  id: "authorized",
  label: "Fonte autorizada",

  async getMovieSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    const baseUrl = getBaseUrl();

    if (!baseUrl || !context.tmdbId) {
      return null;
    }

    return {
      id: `authorized-movie-${context.tmdbId}`,
      provider: "authorized",
      type: "iframe",
      url: `${baseUrl}/movie/${context.tmdbId}`,
      label: "Fonte autorizada",
    };
  },

  async getEpisodeSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    const baseUrl = getBaseUrl();

    if (
      !baseUrl ||
      !context.tmdbId ||
      context.season === undefined ||
      context.episode === undefined
    ) {
      return null;
    }

    return {
      id: `authorized-episode-${context.tmdbId}-${context.season}-${context.episode}`,
      provider: "authorized",
      type: "iframe",
      url: `${baseUrl}/tv/${context.tmdbId}/${context.season}/${context.episode}`,
      label: "Fonte autorizada",
    };
  },
};
