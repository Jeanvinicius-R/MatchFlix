"use server";

import { auth } from "@/lib/auth";
import { saveProgressSchema, watchStartSchema } from "@/schemas/playback.schemas";
import { recordWatchStart, saveProgress } from "@/services/playback.service";
import { getActiveProfile } from "@/services/profile.service";

/**
 * The profile always comes from the session + cookie, never from the client,
 * so one profile can't write another's progress. Failures are swallowed on
 * purpose: losing a progress tick must never interrupt playback.
 */
async function resolveProfileId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return (await getActiveProfile(session.user.id))?.id ?? null;
}

export async function saveProgressAction(input: unknown): Promise<void> {
  const parsed = saveProgressSchema.safeParse(input);
  const profileId = await resolveProfileId();
  if (!parsed.success || !profileId) {
    return;
  }

  try {
    await saveProgress(profileId, parsed.data);
  } catch {
    // Unknown content id or a transient DB error — nothing useful to do here.
  }
}

export async function recordWatchStartAction(input: unknown): Promise<void> {
  const parsed = watchStartSchema.safeParse(input);
  const profileId = await resolveProfileId();
  if (!parsed.success || !profileId) {
    return;
  }

  try {
    await recordWatchStart(profileId, parsed.data);
  } catch {
    // See saveProgressAction.
  }
}
