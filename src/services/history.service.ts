import {
  findProgressForContent,
  findWatchHistory,
} from "@/repositories/history.repository";

export interface HistoryEntry {
  /** Movie id or episode id — one entry per watched item. */
  key: string;
  kind: "movie" | "episode";
  title: string;
  /** Release year for movies; "T1 · E3 — Título" for episodes. */
  subtitle: string;
  posterUrl: string | null;
  lastWatchedAt: Date;
  href: string;
  /** 0–100, or null when no progress was ever saved (e.g. an iframe source). */
  progressPercent: number | null;
  completed: boolean;
}

interface ProgressRow {
  positionInSeconds: number;
  durationInSeconds: number;
  completed: boolean;
}

export function toProgressPercent(progress: ProgressRow | undefined): number | null {
  if (!progress || progress.durationInSeconds <= 0) {
    return null;
  }
  return Math.min(
    100,
    Math.round((progress.positionInSeconds / progress.durationInSeconds) * 100),
  );
}

/**
 * The profile's history, newest first, one entry per movie/episode (the log
 * keeps every playback start; repeating the same title would just be noise).
 */
export async function getWatchHistory(
  profileId: string,
  kidsOnly: boolean,
): Promise<HistoryEntry[]> {
  const rows = await findWatchHistory(profileId, kidsOnly);

  const seen = new Set<string>();
  const latest = rows.filter((row) => {
    const key = row.movie?.id ?? row.episode?.id;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const progress = await findProgressForContent(
    profileId,
    latest.flatMap((row) => (row.movie ? [row.movie.id] : [])),
    latest.flatMap((row) => (row.episode ? [row.episode.id] : [])),
  );
  const progressByKey = new Map(
    progress.map((item) => [item.movieId ?? item.episodeId ?? "", item]),
  );

  return latest.flatMap((row): HistoryEntry[] => {
    if (row.movie) {
      const saved = progressByKey.get(row.movie.id);
      return [
        {
          key: row.movie.id,
          kind: "movie",
          title: row.movie.title,
          subtitle: String(row.movie.releaseYear),
          posterUrl: row.movie.poster?.url ?? null,
          lastWatchedAt: row.watchedAt,
          href: `/watch/${row.movie.slug}`,
          progressPercent: toProgressPercent(saved),
          completed: saved?.completed ?? false,
        },
      ];
    }
    if (row.episode) {
      const saved = progressByKey.get(row.episode.id);
      const { series, seasonNumber } = row.episode.season;
      return [
        {
          key: row.episode.id,
          kind: "episode",
          title: series.title,
          subtitle: `T${seasonNumber} · E${row.episode.episodeNumber} — ${row.episode.title}`,
          posterUrl: series.poster?.url ?? null,
          lastWatchedAt: row.watchedAt,
          href: `/watch/series/${series.slug}?e=${row.episode.id}`,
          progressPercent: toProgressPercent(saved),
          completed: saved?.completed ?? false,
        },
      ];
    }
    return [];
  });
}
