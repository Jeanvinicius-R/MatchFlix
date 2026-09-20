import { isRateLimited, resetRateLimit } from "@/lib/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  createUser,
  existsUserWithEmail,
  findUserByEmail,
  findUserById,
  updateUserEmail,
  updateUserName,
  updateUserPasswordHash,
} from "@/repositories/user.repository";
import type {
  ChangePasswordInput,
  SignInInput,
  SignUpInput,
  UpdateEmailInput,
  UpdateNameInput,
} from "@/schemas/auth.schemas";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

// A real Argon2id hash with no corresponding password. Used to burn the same
// CPU time as a real verification when the email doesn't exist, so response
// timing can't be used to enumerate registered accounts.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$omRLAbGrzOkumSiRAarAUg$llnA12EXfOB80armF9nyAM5u/L9sENFla704B/+HUEo";

export class EmailAlreadyInUseError extends Error {
  constructor() {
    super("Este e-mail já está cadastrado.");
    this.name = "EmailAlreadyInUseError";
  }
}

export class TooManyLoginAttemptsError extends Error {
  constructor() {
    super("Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.");
    this.name = "TooManyLoginAttemptsError";
  }
}

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("Senha atual incorreta.");
    this.name = "InvalidCurrentPasswordError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("Conta não encontrada.");
    this.name = "UserNotFoundError";
  }
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
}

export async function registerUser(
  input: Pick<SignUpInput, "name" | "email" | "password">,
) {
  if (await existsUserWithEmail(input.email)) {
    throw new EmailAlreadyInUseError();
  }

  const passwordHash = await hashPassword(input.password);
  return createUser({ name: input.name, email: input.email, passwordHash });
}

export async function verifyCredentials(
  input: SignInInput,
): Promise<AuthenticatedUser | null> {
  if (
    isRateLimited(`login:${input.email}`, LOGIN_ATTEMPT_LIMIT, LOGIN_ATTEMPT_WINDOW_MS)
  ) {
    throw new TooManyLoginAttemptsError();
  }

  const user = await findUserByEmail(input.email);
  if (!user) {
    await verifyPassword(DUMMY_PASSWORD_HASH, input.password).catch(() => false);
    return null;
  }

  const isPasswordValid = await verifyPassword(user.passwordHash, input.password);
  if (!isPasswordValid) {
    return null;
  }

  resetRateLimit(`login:${input.email}`);
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export interface AccountSummary {
  name: string;
  email: string;
}

export async function getAccount(userId: string): Promise<AccountSummary> {
  const user = await findUserById(userId);
  if (!user) {
    throw new UserNotFoundError();
  }
  return { name: user.name, email: user.email };
}

export async function updateAccountName(
  userId: string,
  input: UpdateNameInput,
): Promise<void> {
  await getAccount(userId);
  await updateUserName(userId, input.name);
}

/**
 * Changing the email or password re-checks the current password (and counts
 * failures against a rate limit), so an unattended, still-signed-in browser
 * can't be used to take over the account.
 */
async function assertCurrentPassword(userId: string, currentPassword: string) {
  const rateLimitKey = `account:${userId}`;
  if (isRateLimited(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_ATTEMPT_WINDOW_MS)) {
    throw new TooManyLoginAttemptsError();
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new UserNotFoundError();
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new InvalidCurrentPasswordError();
  }

  resetRateLimit(rateLimitKey);
  return user;
}

export async function updateAccountEmail(
  userId: string,
  input: UpdateEmailInput,
): Promise<void> {
  const user = await assertCurrentPassword(userId, input.currentPassword);

  if (input.email === user.email) {
    return;
  }
  if (await existsUserWithEmail(input.email)) {
    throw new EmailAlreadyInUseError();
  }

  try {
    await updateUserEmail(userId, input.email);
  } catch (error) {
    // Lost a race against another signup with the same address (Prisma unique violation).
    if ((error as { code?: string }).code === "P2002") {
      throw new EmailAlreadyInUseError();
    }
    throw error;
  }
}

export async function changeAccountPassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  await assertCurrentPassword(userId, input.currentPassword);
  await updateUserPasswordHash(userId, await hashPassword(input.newPassword));
}
