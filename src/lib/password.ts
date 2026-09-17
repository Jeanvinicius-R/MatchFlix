import { hash, verify } from "@node-rs/argon2";

/** Argon2id with sane defaults (19 MiB memory, 2 iterations, 1 thread — OWASP baseline). */
export function hashPassword(plainTextPassword: string): Promise<string> {
  return hash(plainTextPassword);
}

export function verifyPassword(
  hashedPassword: string,
  plainTextPassword: string,
): Promise<boolean> {
  return verify(hashedPassword, plainTextPassword);
}
