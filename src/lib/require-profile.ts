import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getActiveProfile } from "@/services/profile.service";
import type { ProfileSummary } from "@/types/profile.types";

/** Pages that play content need a signed-in user with a chosen profile. */
export async function requireProfile(): Promise<ProfileSummary> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const profile = await getActiveProfile(session.user.id);
  if (!profile) {
    redirect("/profiles");
  }
  return profile;
}
