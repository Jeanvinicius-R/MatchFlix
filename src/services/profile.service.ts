import {
  clearActiveProfileCookie,
  readActiveProfileCookie,
  writeActiveProfileCookie,
} from "@/lib/active-profile-cookie";
import {
  createProfile,
  findProfileById,
  findProfilesByUserId,
} from "@/repositories/profile.repository";
import type { CreateProfileInput } from "@/schemas/profile.schemas";
import type { ProfileSummary } from "@/types/profile.types";

const MAX_PROFILES_PER_ACCOUNT = 5;

export class ProfileLimitReachedError extends Error {
  constructor() {
    super(`Você já atingiu o limite de ${MAX_PROFILES_PER_ACCOUNT} perfis por conta.`);
    this.name = "ProfileLimitReachedError";
  }
}

export class ProfileNotOwnedError extends Error {
  constructor() {
    super("Perfil não encontrado.");
    this.name = "ProfileNotOwnedError";
  }
}

export function listProfiles(userId: string): Promise<ProfileSummary[]> {
  return findProfilesByUserId(userId);
}

export async function registerProfile(
  userId: string,
  input: CreateProfileInput,
): Promise<ProfileSummary> {
  const existingProfiles = await findProfilesByUserId(userId);
  if (existingProfiles.length >= MAX_PROFILES_PER_ACCOUNT) {
    throw new ProfileLimitReachedError();
  }

  return createProfile({ userId, name: input.name, isKids: input.isKids });
}

/** Verifies the profile belongs to the account before trusting it for anything. */
async function requireOwnedProfile(
  userId: string,
  profileId: string,
): Promise<ProfileSummary> {
  const profile = await findProfileById(profileId);
  if (!profile || profile.userId !== userId) {
    throw new ProfileNotOwnedError();
  }
  return profile;
}

export async function selectProfile(userId: string, profileId: string): Promise<void> {
  await requireOwnedProfile(userId, profileId);
  await writeActiveProfileCookie(profileId);
}

/**
 * Returns the active profile, but only if it still belongs to this user —
 * a stale or forged cookie (e.g. after switching accounts) is treated as
 * "no active profile" and cleared, never trusted at face value.
 */
export async function getActiveProfile(userId: string): Promise<ProfileSummary | null> {
  const activeProfileId = await readActiveProfileCookie();
  if (!activeProfileId) {
    return null;
  }

  const profile = await findProfileById(activeProfileId);
  if (!profile || profile.userId !== userId) {
    await clearActiveProfileCookie();
    return null;
  }

  return profile;
}
