import {
  findMovieProgress,
  findSeriesForPlaybackBySlug,
  findSeriesProgress,
  insertWatchHistory,
  upsertEpisodeProgress,
  upsertMovieProgress,
} from "@/repositories/playback.repository";
import type { SaveProgressInput, WatchStartInput } from "@/schemas/playback.schemas";

/** A title counts as finished once the viewer is within the last 5% (credits). */
const COMPLETED_RATIO = 0.95;

/** Returns null when the series is missing, inactive or off-limits for a kids profile. */
export async function getSeriesForPlayback(slug: string, kidsOnly: boolean) {
  const series = await findSeriesForPlaybackBySlug(slug);
  if (!series || !series.isActive || (kidsOnly && series.ageRating !== "L")) {
    return null;
  }
  return series;
}

/** Where to resume a movie: 0 when never watched or already finished. */
export async function getMovieResumePosition(
  profileId: string,
  movieId: string,
): Promise<number> {
  const progress = await findMovieProgress(profileId, movieId);
  return progress && !progress.completed ? progress.positionInSeconds : 0;
}

export function getSeriesProgress(profileId: string, seriesId: string) {
  return findSeriesProgress(profileId, seriesId);
}

export async function saveProgress(
  profileId: string,
  input: SaveProgressInput,
): Promise<void> {
  const duration = Math.round(input.durationInSeconds);
  const position = Math.min(Math.round(input.positionInSeconds), duration);
  const values = {
    positionInSeconds: position,
    durationInSeconds: duration,
    completed: position / duration >= COMPLETED_RATIO,
  };

  if (input.kind === "movie") {
    await upsertMovieProgress(profileId, input.contentId, values);
  } else {
    await upsertEpisodeProgress(profileId, input.contentId, values);
  }
}

export async function recordWatchStart(
  profileId: string,
  input: WatchStartInput,
): Promise<void> {
  await insertWatchHistory(
    profileId,
    input.kind === "movie"
      ? { movieId: input.contentId }
      : { episodeId: input.contentId },
  );
}
