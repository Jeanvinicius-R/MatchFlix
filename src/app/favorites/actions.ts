"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { toggleFavoriteSchema } from "@/schemas/favorite.schemas";
import { toggleMyList } from "@/services/favorite.service";
import { getActiveProfile } from "@/services/profile.service";

export interface ToggleFavoriteResult {
  /** The new state, or undefined when nothing changed (not signed in, no profile, unknown title). */
  isFavorite?: boolean;
}

/** The profile always comes from the session + cookie, never from the client. */
export async function toggleFavoriteAction(
  input: unknown,
): Promise<ToggleFavoriteResult> {
  const parsed = toggleFavoriteSchema.safeParse(input);
  const session = await auth();
  if (!parsed.success || !session?.user) {
    return {};
  }

  const profile = await getActiveProfile(session.user.id);
  if (!profile) {
    return {};
  }

  try {
    const isFavorite = await toggleMyList(profile.id, parsed.data);
    revalidatePath("/my-list");
    return { isFavorite };
  } catch {
    // Unknown content id (FK violation) — treat as a no-op.
    return {};
  }
}
