import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getActiveProfile } from "@/services/profile.service";

/**
 * Catalog pages are public, but a signed-in user must have picked a profile
 * first — and a kids profile only ever sees content rated "L".
 */
export async function getBrowsingContext(): Promise<{ kidsOnly: boolean }> {
  const session = await auth();
  if (!session?.user) {
    return { kidsOnly: false };
  }

  const activeProfile = await getActiveProfile(session.user.id);
  if (!activeProfile) {
    redirect("/profiles");
  }
  return { kidsOnly: activeProfile.isKids };
}
