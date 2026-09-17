import { prisma } from "@/lib/prisma";
import type { ProfileSummary } from "@/types/profile.types";

const PROFILE_SELECT = { id: true, userId: true, name: true, isKids: true } as const;

export function findProfilesByUserId(userId: string): Promise<ProfileSummary[]> {
  return prisma.profile.findMany({
    where: { userId },
    select: PROFILE_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

export function findProfileById(id: string): Promise<ProfileSummary | null> {
  return prisma.profile.findUnique({ where: { id }, select: PROFILE_SELECT });
}

interface CreateProfileRecordInput {
  userId: string;
  name: string;
  isKids: boolean;
}

export function createProfile(input: CreateProfileRecordInput): Promise<ProfileSummary> {
  return prisma.profile.create({ data: input, select: PROFILE_SELECT });
}
