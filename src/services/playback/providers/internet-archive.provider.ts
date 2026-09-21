import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";

const ARCHIVE_EMBED_URL = "https://archive.org/embed";

/** Archive identifiers are ASCII slugs. Anything else never reaches a URL. */
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Curated catalog: TMDB movie id -> Internet Archive item identifier.
 *
 * Only add titles that are public domain or openly licensed. This provider
 * never searches the Archive, so a title that is not listed here has no source.
 *
 * Format (the identifier is the last part of https://archive.org/details/<itemId>):
 *   [tmdbId, "itemId"],
 *
 * Intentionally empty until real, verified entries are added.
 */
const CURATED_MOVIES: ReadonlyMap<number, string> = new Map<number, string>([
  [3085, "his_girl_friday"], // His Girl Friday (1940), domínio público
]);

export const internetArchiveProvider: PlaybackProvider = {
  id: "internet-archive",
  label: "Internet Archive",

  async getMovieSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    const itemId = CURATED_MOVIES.get(context.tmdbId);

    if (!itemId || !ITEM_ID_PATTERN.test(itemId)) {
      return null;
    }

    return {
      id: `internet-archive-movie-${context.tmdbId}`,
      provider: "internet-archive",
      type: "iframe",
      url: `${ARCHIVE_EMBED_URL}/${encodeURIComponent(itemId)}`,
      label: "Internet Archive",
    };
  },

  // No curated episode catalog yet.
  async getEpisodeSource(): Promise<PlaybackSource | null> {
    return null;
  },
};
