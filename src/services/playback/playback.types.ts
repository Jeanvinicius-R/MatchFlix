export type PlaybackType = "iframe" | "hls" | "direct" | "external";

export interface PlaybackSource {
  id: string;
  provider: string;
  type: PlaybackType;
  url: string;
  label?: string;
  /** Free-form quality hint (e.g. "1080p", "HD") — optional, not enforced. */
  quality?: string;
}

export interface PlaybackContext {
  tmdbId: number;
  season?: number;
  episode?: number;

  // TMDB metadata, filled in when available, for providers that search by
  // name (YouTube). Providers that only need ids can ignore these.

  /** Movie title, or the series name for an episode (pt-BR). */
  title?: string;
  originalTitle?: string;
  year?: number;
  episodeTitle?: string;
  /** Movie or episode runtime in minutes. */
  runtimeMinutes?: number;
}

export interface PlaybackProvider {
  id: string;
  label: string;

  getMovieSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null>;

  getEpisodeSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null>;
}