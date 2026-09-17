"use server";

import { signOut } from "@/lib/auth";
import { clearActiveProfileCookie } from "@/lib/active-profile-cookie";

export async function logoutAction(): Promise<void> {
  await clearActiveProfileCookie();
  await signOut({ redirectTo: "/" });
}
