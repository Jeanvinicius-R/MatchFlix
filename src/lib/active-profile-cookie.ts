import { cookies } from "next/headers";

/**
 * Which profile is currently "being watched" — separate from the auth
 * session cookie on purpose, since switching profiles shouldn't require
 * signing in again. Ownership is re-checked on every read in
 * profile.service.ts; this module only moves the raw value in and out.
 */
const ACTIVE_PROFILE_COOKIE = "active_profile_id";

export async function readActiveProfileCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_PROFILE_COOKIE)?.value ?? null;
}

export async function writeActiveProfileCookie(profileId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_PROFILE_COOKIE, profileId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function clearActiveProfileCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_PROFILE_COOKIE);
}
