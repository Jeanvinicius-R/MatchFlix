import { prisma } from "@/lib/prisma";

/**
 * Shape returned to the auth flow: enough to verify credentials and
 * populate the session, and nothing more (never select raw fields blindly).
 */
export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  passwordHash: string;
}

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  passwordHash: true,
} as const;

export function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  return prisma.user.findUnique({ where: { email }, select: AUTH_USER_SELECT });
}

export function existsUserWithEmail(email: string): Promise<boolean> {
  return prisma.user.count({ where: { email } }).then((count) => count > 0);
}

interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export function createUser(input: CreateUserInput): Promise<{ id: string }> {
  return prisma.user.create({ data: input, select: { id: true } });
}

export function findUserById(id: string): Promise<AuthUserRecord | null> {
  return prisma.user.findUnique({ where: { id }, select: AUTH_USER_SELECT });
}

export async function updateUserName(id: string, name: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { name } });
}

export async function updateUserEmail(id: string, email: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { email } });
}

export async function updateUserPasswordHash(
  id: string,
  passwordHash: string,
): Promise<void> {
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}
