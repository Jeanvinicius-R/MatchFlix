import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getActiveProfile } from "@/services/profile.service";

/**
 * Catalog pages are public, but a signed-in user must have picked a profile
 * first — and a kids profile only ever sees content rated "L".
 */
export async function getBrowsingContext(): Promise<{
  kidsOnly: boolean;
  profileId: string | null;
}> {
  const session = await auth();
  if (!session?.user) {
    return { kidsOnly: false, profileId: null };
  }

  const activeProfile = await getActiveProfile(session.user.id);
  if (!activeProfile) {
    redirect("/profiles");
  }
  return { kidsOnly: activeProfile.isKids, profileId: activeProfile.id };
}
