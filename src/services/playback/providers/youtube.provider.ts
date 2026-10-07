import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";

/**
 * YouTube via the official Data API v3 (search.list + videos.list) and the
 * official embed player. Nothing else: no scraping, no stream URLs.
 *
 * The API cannot tell whether a video is *authorized* to distribute a movie
 * or episode — `status.embeddable` only means the uploader allows embedding,
 * and `contentDetails.licensedContent` only means the channel is linked to a
 * content partner. Neither proves a license. So this provider never trusts a
 * search result by itself: a video is only accepted when its channel is in
 * YOUTUBE_ALLOWED_CHANNEL_IDS, set by the site administrator. That list is
 * the administrator's own decision, not an automatic copyright check — the
 * provider cannot and does not verify rights.
 *
 * Quota: search.list has its own bucket of 100 calls/day, so each request
 * makes at most one search.list + one videos.list call, and both responses
 * go through Next's data cache (same pattern as the TMDB client).
 */

const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_EMBED_URL = "https://www.youtube.com/embed";

/** Same region as "Onde assistir" — this is a Brazilian catalog. */
const REGION_CODE = "BR";

/** Candidates checked per request — all of them fit in one videos.list call. */
const MAX_CANDIDATES = 10;

/** Search results barely change within a day; API data must not outlive 30 days. */
const CACHE_REVALIDATE_SECONDS = 60 * 60 * 24;

/**
 * Below this share of the TMDB runtime, a video is a trailer/clip, not the
 * full title. Without a TMDB runtime, MIN_*_MINUTES apply instead.
 */
const MIN_RUNTIME_RATIO = 0.75;
const MIN_MOVIE_MINUTES = 40;
const MIN_EPISODE_MINUTES = 10;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Parses YOUTUBE_ALLOWED_CHANNEL_IDS: comma-separated channel IDs ("UC…",
 * from the channel's URL or "Compartilhar canal"). Blanks and anything that
 * is not a channel ID are dropped.
 *
 * The administrator lists only channels they checked actually hold the rights
 * to the full titles — being an "official" channel is not enough (most only
 * publish trailers). An empty set means the provider is off and makes no API
 * calls.
 */
export function parseAllowedChannelIds(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => CHANNEL_ID_PATTERN.test(id)),
  );
}

interface YoutubeSearchResponse {
  items?: {
    id?: { videoId?: string };
  }[];
}

export interface YoutubeVideo {
  id: string;
  snippet?: {
    title?: string;
    channelId?: string;
    liveBroadcastContent?: string;
  };
  contentDetails?: {
    duration?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
  };
  status?: {
    uploadStatus?: string;
    privacyStatus?: string;
    embeddable?: boolean;
  };
}

interface YoutubeVideoListResponse {
  items?: YoutubeVideo[];
}

/** What the video's title must mention, and how long it must be. */
export interface MatchRule {
  /** At least one of these must appear in the title (series or movie name). */
  titles: string[];
  /** When non-empty, at least one of these must appear too (episode markers). */
  markers: string[];
  minMinutes: number;
}

function getApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY?.trim() || null;
}

/** Lowercase, no accents, no punctuation — so "Ação!" matches "acao". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueNonEmpty(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => normalize(value ?? "")).filter(Boolean))];
}

/** ISO 8601 duration ("PT1H32M10S") -> minutes, or null when unparseable. */
export function parseDurationMinutes(duration: string | undefined): number | null {
  const match = duration?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);

  if (!match) {
    return null;
  }

  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return days * 24 * 60 + hours * 60 + minutes + seconds / 60;
}

function isAvailableInRegion(video: YoutubeVideo): boolean {
  const restriction = video.contentDetails?.regionRestriction;

  if (restriction?.allowed) {
    return restriction.allowed.includes(REGION_CODE);
  }

  return !restriction?.blocked?.includes(REGION_CODE);
}

/** Every check a video must pass to become a playback source. */
export function isAcceptable(
  video: YoutubeVideo,
  rule: MatchRule,
  allowedChannelIds: ReadonlySet<string>,
): boolean {
  // Padded so a match is always on whole words ("up" never matches "group").
  const title = ` ${normalize(video.snippet?.title ?? "")} `;
  const mentions = (term: string) => title.includes(` ${term} `);
  const minutes = parseDurationMinutes(video.contentDetails?.duration);

  return (
    VIDEO_ID_PATTERN.test(video.id) &&
    allowedChannelIds.has(video.snippet?.channelId ?? "") &&
    video.status?.embeddable === true &&
    video.status.privacyStatus === "public" &&
    video.status.uploadStatus === "processed" &&
    video.snippet?.liveBroadcastContent === "none" &&
    isAvailableInRegion(video) &&
    minutes !== null &&
    minutes >= rule.minMinutes &&
    rule.titles.some(mentions) &&
    (rule.markers.length === 0 || rule.markers.some(mentions))
  );
}

async function youtubeGet<TResponse>(
  path: string,
  searchParams: Record<string, string>,
  apiKey: string,
): Promise<TResponse> {
  const url = new URL(`${YOUTUBE_API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    // Never log `url` — it carries the API key.
    let reason = "";
    try {
      const body = (await response.json()) as {
        error?: { errors?: { reason?: string }[] };
      };
      reason = body.error?.errors?.[0]?.reason ?? "";
    } catch {
      // Body is not JSON — the status code alone is enough.
    }
    throw new Error(
      `YouTube Data API ${path} respondeu HTTP ${response.status}${reason ? ` (${reason})` : ""}`,
    );
  }

  return response.json() as Promise<TResponse>;
}

async function findVideo(
  query: string,
  rule: MatchRule,
  isMovie: boolean,
): Promise<string | null> {
  const apiKey = getApiKey();
  const allowed = parseAllowedChannelIds(process.env.YOUTUBE_ALLOWED_CHANNEL_IDS);

  if (!apiKey || allowed.size === 0 || !query.trim()) {
    return null;
  }

  try {
    const search = await youtubeGet<YoutubeSearchResponse>(
      "/search",
      {
        part: "snippet",
        type: "video",
        q: query,
        maxResults: String(MAX_CANDIDATES),
        regionCode: REGION_CODE,
        // Pre-filters only; videos.list below is what actually decides.
        videoEmbeddable: "true",
        videoSyndicated: "true",
        ...(isMovie ? { videoDuration: "long" } : {}),
        // search.list takes a single channelId: with one allowed channel the
        // search is scoped to it; with more, results are filtered afterwards.
        ...(allowed.size === 1 ? { channelId: [...allowed][0] } : {}),
      },
      apiKey,
    );

    const ids = [
      ...new Set(
        (search.items ?? [])
          .map((item) => item.id?.videoId)
          .filter((id): id is string => !!id && VIDEO_ID_PATTERN.test(id)),
      ),
    ];

    if (ids.length === 0) {
      return null;
    }

    const details = await youtubeGet<YoutubeVideoListResponse>(
      "/videos",
      { part: "snippet,contentDetails,status", id: ids.join(",") },
      apiKey,
    );

    // Keep search relevance order: the first video that passes wins.
    const byId = new Map((details.items ?? []).map((video) => [video.id, video]));
    const match = ids
      .map((id) => byId.get(id))
      .find((video) => video && isAcceptable(video, rule, allowed));

    return match?.id ?? null;
  } catch (error) {
    console.warn(
      "YouTube provider: busca falhou —",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function minMinutes(runtimeMinutes: number | undefined, fallback: number): number {
  return runtimeMinutes ? runtimeMinutes * MIN_RUNTIME_RATIO : fallback;
}

export const youtubeProvider: PlaybackProvider = {
  id: "youtube",
  label: "YouTube",

  async getMovieSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    if (!context.tmdbId || !context.title) {
      return null;
    }

    const query = [context.title, context.year, "-trailer", "-teaser"]
      .filter(Boolean)
      .join(" ");

    const videoId = await findVideo(
      query,
      {
        titles: uniqueNonEmpty([context.title, context.originalTitle]),
        markers: [],
        minMinutes: minMinutes(context.runtimeMinutes, MIN_MOVIE_MINUTES),
      },
      true,
    );

    if (!videoId) {
      return null;
    }

    return {
      id: `youtube-movie-${context.tmdbId}`,
      provider: "youtube",
      type: "iframe",
      url: `${YOUTUBE_EMBED_URL}/${videoId}`,
      label: "YouTube",
    };
  },

  async getEpisodeSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    const { tmdbId, season, episode, title } = context;

    if (!tmdbId || !title || season === undefined || episode === undefined) {
      return null;
    }

    const s = String(season);
    const e = String(episode);
    const query = [title, context.episodeTitle, "-trailer", "-teaser"]
      .filter(Boolean)
      .join(" ");

    const videoId = await findVideo(
      query,
      {
        titles: uniqueNonEmpty([title, context.originalTitle]),
        // The episode title, or a season/episode marker like "S01E02",
        // "T1 E2" or "1x02" — normalize() turns these into space-split tokens.
        markers: uniqueNonEmpty([
          context.episodeTitle,
          `s${s.padStart(2, "0")}e${e.padStart(2, "0")}`,
          `s${s}e${e}`,
          `t${s} e${e}`,
          `t${s}e${e}`,
          `${s}x${e.padStart(2, "0")}`,
          `temporada ${s} episodio ${e}`,
          `season ${s} episode ${e}`,
        ]),
        minMinutes: minMinutes(context.runtimeMinutes, MIN_EPISODE_MINUTES),
      },
      false,
    );

    if (!videoId) {
      return null;
    }

    return {
      id: `youtube-episode-${tmdbId}-${season}-${episode}`,
      provider: "youtube",
      type: "iframe",
      url: `${YOUTUBE_EMBED_URL}/${videoId}`,
      label: "YouTube",
    };
  },
};
