/** Thrown on edit when the admin picks a slug already used by another record. */
export class SlugAlreadyInUseError extends Error {
  constructor() {
    super("Esse slug já está em uso por outro registro.");
    this.name = "SlugAlreadyInUseError";
  }
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Appends a numeric suffix until `isTaken` reports the candidate is free.
 * Used on create only — titles legitimately collide (remakes, common words),
 * so create should never fail on a slug clash, only auto-disambiguate.
 */
export async function generateUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const baseSlug = slugify(base);
  let candidate = baseSlug;
  let suffix = 2;

  while (await isTaken(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
