import { prisma } from "@/lib/prisma";
import {
  ageRatingFilterFor,
  MOVIE_SELECT,
  SERIES_SELECT,
} from "@/repositories/content.repository";
import {
  mapMovieToContentSummary,
  mapSeriesToContentSummary,
} from "@/repositories/content.mapper";
import { getPlayableLookup } from "@/services/playback/playable-titles.default";
import type { ContentSummary } from "@/types/content.types";

export type FavoriteTarget = { kind: "movie" | "series"; contentId: string };

/** The profile's list, newest first. Inactive titles and titles a kids profile can't see are hidden. */
export async function findFavoriteContent(
  profileId: string,
  kidsOnly: boolean,
): Promise<ContentSummary[]> {
  const visible = { isActive: true, ...ageRatingFilterFor(kidsOnly) };

  const [favorites, playable] = await Promise.all([
    prisma.favorite.findMany({
      where: {
        profileId,
        OR: [{ movie: visible }, { series: visible }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        movie: { select: MOVIE_SELECT },
        series: { select: SERIES_SELECT },
      },
    }),
    getPlayableLookup(),
  ]);

  return favorites.flatMap(({ movie, series }) => {
    if (movie) return [mapMovieToContentSummary(movie, playable)];
    if (series) return [mapSeriesToContentSummary(series, playable)];
    return [];
  });
}

function whereFor(profileId: string, { kind, contentId }: FavoriteTarget) {
  return kind === "movie"
    ? { profileId, movieId: contentId }
    : { profileId, seriesId: contentId };
}

export async function isFavorite(
  profileId: string,
  target: FavoriteTarget,
): Promise<boolean> {
  return (await prisma.favorite.count({ where: whereFor(profileId, target) })) > 0;
}

/** Adds the title to the list, or removes it if already there. Returns the new state. */
export async function toggleFavorite(
  profileId: string,
  target: FavoriteTarget,
): Promise<boolean> {
  const existing = await prisma.favorite.findFirst({
    where: whereFor(profileId, target),
    select: { id: true },
  });

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return false;
  }

  await prisma.favorite.create({ data: whereFor(profileId, target) });
  return true;
}
