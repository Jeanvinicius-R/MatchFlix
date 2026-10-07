import { prisma } from "@/lib/prisma";
import { removeStoredFiles } from "@/lib/storage/local-storage";
import { deleteMediaIfPresent } from "@/repositories/media.repository";
import type { ProfileSummary } from "@/types/profile.types";

const PROFILE_SELECT = {
  id: true,
  userId: true,
  name: true,
  isKids: true,
  avatarMedia: { select: { url: true } },
} as const;

type ProfileRow = {
  id: string;
  userId: string;
  name: string;
  isKids: boolean;
  avatarMedia: { url: string } | null;
};

function toSummary({ avatarMedia, ...profile }: ProfileRow): ProfileSummary {
  return { ...profile, avatarUrl: avatarMedia?.url ?? null };
}

export async function findProfilesByUserId(userId: string): Promise<ProfileSummary[]> {
  const rows = await prisma.profile.findMany({
    where: { userId },
    select: PROFILE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSummary);
}

export async function findProfileById(id: string): Promise<ProfileSummary | null> {
  const row = await prisma.profile.findUnique({ where: { id }, select: PROFILE_SELECT });
  return row ? toSummary(row) : null;
}

interface ProfileFields {
  name: string;
  isKids: boolean;
}

export async function createProfile(
  input: ProfileFields & { userId: string },
): Promise<ProfileSummary> {
  return toSummary(await prisma.profile.create({ data: input, select: PROFILE_SELECT }));
}

export async function updateProfile(id: string, input: ProfileFields): Promise<void> {
  await prisma.profile.update({ where: { id }, data: input });
}

/**
 * Deletes the profile (its history, progress and favorites cascade in the
 * database) and its avatar Media — removing the avatar file after commit.
 */
export async function deleteProfile(id: string): Promise<void> {
  const orphans: (string | null)[] = [];
  await prisma.$transaction(async (tx) => {
    const current = await tx.profile.findUnique({
      where: { id },
      select: { avatarMediaId: true },
    });
    await tx.profile.delete({ where: { id } });
    orphans.push(await deleteMediaIfPresent(tx, current?.avatarMediaId));
  });
  await removeStoredFiles(orphans);
}
