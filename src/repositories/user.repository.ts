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
