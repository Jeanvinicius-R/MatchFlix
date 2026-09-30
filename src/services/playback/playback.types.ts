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