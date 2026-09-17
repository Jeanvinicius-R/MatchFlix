import { isRateLimited, resetRateLimit } from "@/lib/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  createUser,
  existsUserWithEmail,
  findUserByEmail,
} from "@/repositories/user.repository";
import type { SignInInput, SignUpInput } from "@/schemas/auth.schemas";

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
