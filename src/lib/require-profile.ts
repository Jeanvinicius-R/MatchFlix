import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withNext } from "@/lib/next-path";
import { getActiveProfile } from "@/services/profile.service";
import type { ProfileSummary } from "@/types/profile.types";

/**
 * Pages that play content need a signed-in user with a chosen profile.
 * `nextPath` is where to send them back to once that is sorted out.
 */
export async function requireProfile(nextPath?: string): Promise<ProfileSummary> {
  const next = nextPath ?? null;

  const session = await auth();
  if (!session?.user) {
    redirect(withNext("/login", next));
  }
  const profile = await getActiveProfile(session.user.id);
  if (!profile) {
    redirect(withNext("/profiles", next));
  }
  return profile;
}
