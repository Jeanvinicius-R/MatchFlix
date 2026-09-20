import {
  findFavoriteContent,
  isFavorite,
  toggleFavorite,
  type FavoriteTarget,
} from "@/repositories/favorite.repository";
import type { ContentSummary } from "@/types/content.types";

export function getMyList(
  profileId: string,
  kidsOnly: boolean,
): Promise<ContentSummary[]> {
  return findFavoriteContent(profileId, kidsOnly);
}

export function isInMyList(profileId: string, target: FavoriteTarget): Promise<boolean> {
  return isFavorite(profileId, target);
}

export function toggleMyList(
  profileId: string,
  target: FavoriteTarget,
): Promise<boolean> {
  return toggleFavorite(profileId, target);
}
