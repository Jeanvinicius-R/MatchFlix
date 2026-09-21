import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";

/** Base URL without trailing slashes, or null when the env var is not set. */
function getBaseUrl(): string | null {
  const baseUrl = process.env.PLAYBACK_PROVIDER_BASE_URL?.trim();

  if (!baseUrl) {
    return null;
  }

  return baseUrl.replace(/\/+$/, "");
}

export const exampleProvider: PlaybackProvider = {
  id: "example",
  label: "Example Provider",

  async getMovieSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    const baseUrl = getBaseUrl();

    if (!baseUrl || !context.tmdbId) {
      return null;
    }

    return {
      id: `example-movie-${context.tmdbId}`,
      provider: "example",
      type: "iframe",
      url: `${baseUrl}/embed/movie/${context.tmdbId}`,
      label: "Servidor principal",
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
      id: `example-episode-${context.tmdbId}-${context.season}-${context.episode}`,
      provider: "example",
      type: "iframe",
      url:
        `${baseUrl}/embed/tv/` +
        `${context.tmdbId}/${context.season}/${context.episode}`,
      label: "Servidor principal",
    };
  },
};
