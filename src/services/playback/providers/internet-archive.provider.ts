import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";

const ARCHIVE_EMBED_URL = "https://archive.org/embed";

/** Archive identifiers are ASCII slugs. Anything else never reaches a URL. */
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface CuratedArchiveMovie {
  tmdbId: number;
  /** Last part of https://archive.org/details/<itemId>. */
  itemId: string;
  title: string;
  year: number;
  /** Why this title may be shown — checked by hand, never inferred. */
  license: string;
}

/**
 * Curated catalog: each entry was checked by hand. This provider never
 * searches the Archive — a title not listed here has no source, and being on
 * archive.org is not, by itself, proof that a title is free to show.
 *
 * Inclusion rule (Brazilian catalog): the item's own metadata declares it
 * public domain AND the film was published before 1956, so it is in the public
 * domain in Brazil too (Lei 9.610/98, art. 44: audiovisual works, 70 years from
 * 1 January after publication). Titles that are public domain only in the US
 * (e.g. Night of the Living Dead, 1968) are left out on purpose.
 *
 * Series/episodes: no curated, verifiable source yet — intentionally none.
 */
export const CURATED_MOVIES: readonly CuratedArchiveMovie[] = [
  {
    tmdbId: 3085,
    itemId: "his_girl_friday",
    title: "His Girl Friday",
    year: 1940,
    license: "Domínio público (metadado do item: creativecommons.org/licenses/publicdomain).",
  },
  {
    tmdbId: 961,
    itemId: "The_General_Buster_Keaton",
    title: "The General",
    year: 1926,
    license: "Domínio público (metadado do item: creativecommons.org/licenses/publicdomain).",
  },
  {
    tmdbId: 20367,
    itemId: "Detour",
    title: "Detour",
    year: 1945,
    license: "Domínio público (metadado do item: creativecommons.org/licenses/publicdomain).",
  },
];

const BY_TMDB_ID: ReadonlyMap<number, CuratedArchiveMovie> = new Map(
  CURATED_MOVIES.filter((entry) => ITEM_ID_PATTERN.test(entry.itemId)).map((entry) => [
    entry.tmdbId,
    entry,
  ]),
);

export function findCuratedArchiveMovie(tmdbId: number): CuratedArchiveMovie | null {
  return BY_TMDB_ID.get(tmdbId) ?? null;
}

export const internetArchiveProvider: PlaybackProvider = {
  id: "internet-archive",
  label: "Internet Archive",

  async getMovieSource(context: PlaybackContext): Promise<PlaybackSource | null> {
    const entry = findCuratedArchiveMovie(context.tmdbId);

    if (!entry) {
      return null;
    }

    return {
      id: `internet-archive-movie-${context.tmdbId}`,
      provider: "internet-archive",
      type: "iframe",
      url: `${ARCHIVE_EMBED_URL}/${encodeURIComponent(entry.itemId)}`,
      label: "Internet Archive",
    };
  },

  // No curated episode catalog — see CURATED_MOVIES.
  async getEpisodeSource(): Promise<PlaybackSource | null> {
    return null;
  },
};
