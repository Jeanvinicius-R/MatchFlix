export type PlaybackType = "iframe" | "hls" | "dash" | "direct" | "external";

/** WebVTT subtitle track offered to the player (rendered as <track kind="subtitles">). */
export interface PlaybackSubtitle {
  /** BCP-47 language code ("pt", "pt-BR", "en"). */
  language: string;
  label: string;
  /** https URL of a .vtt file. */
  url: string;
  isDefault?: boolean;
}

/** One progressive (MP4) rendition; HLS/DASH expose their own levels instead. */
export interface PlaybackQuality {
  /** "1080p", "720p"... */
  label: string;
  height?: number;
  url: string;
}

/** Who made the video and under which licence it may be shown. */
export interface PlaybackAttribution {
  /** Short licence text, e.g. "CC BY 3.0". */
  license?: string;
  /** Author / channel to credit. */
  author?: string;
  /** Page of the original work. */
  sourceUrl?: string;
}

export interface PlaybackSource {
  id: string;
  provider: string;
  type: PlaybackType;
  url: string;
  label?: string;
  /** Free-form quality hint (e.g. "1080p", "HD") — optional, not enforced. */
  quality?: string;
  /** MIME type of `url` when the provider knows it (e.g. "video/mp4"). */
  mimeType?: string;
  /** Progressive renditions the viewer can switch between ("direct" only). */
  qualities?: PlaybackQuality[];
  subtitles?: PlaybackSubtitle[];
  attribution?: PlaybackAttribution;
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
