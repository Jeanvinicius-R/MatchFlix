import { getActiveProfile } from "@/services/profile.service";

/**
 * Whether API listings must hide everything not rated "L": true when the
 * caller's active profile is a kids profile. API clients have no "pick a
 * profile" redirect (unlike the pages), so no active profile means no filter —
 * the same account can switch to any of its profiles anyway.
 */
export async function resolveKidsOnly(userId: string): Promise<boolean> {
  const profile = await getActiveProfile(userId);
  return profile?.isKids ?? false;
}
