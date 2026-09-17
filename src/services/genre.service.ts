import {
  createGenre as createGenreRecord,
  deleteGenre as deleteGenreRecord,
  findAllGenres,
  findGenreById,
  findGenreBySlug,
  updateGenre as updateGenreRecord,
  upsertGenreBySlug,
} from "@/repositories/genre.repository";
import { generateUniqueSlug, slugify, SlugAlreadyInUseError } from "@/utils/slug.utils";

export class GenreNotFoundError extends Error {
  constructor() {
    super("Gênero não encontrado.");
    this.name = "GenreNotFoundError";
  }
}

export function listGenresForAdmin() {
  return findAllGenres();
}

export async function createGenre(input: { name: string }) {
  const slug = await generateUniqueSlug(input.name, async (candidate) =>
    Boolean(await findGenreBySlug(candidate)),
  );
  return createGenreRecord({ name: input.name, slug });
}

export async function updateGenre(id: string, input: { name: string }) {
  const existing = await findGenreById(id);
  if (!existing) {
    throw new GenreNotFoundError();
  }

  const slug = slugify(input.name);
  if (slug !== existing.slug) {
    const collision = await findGenreBySlug(slug);
    if (collision && collision.id !== id) {
      throw new SlugAlreadyInUseError();
    }
  }

  return updateGenreRecord(id, { name: input.name, slug });
}

export async function deleteGenre(id: string): Promise<void> {
  await deleteGenreRecord(id);
}

/**
 * Resolves free-text genre names (manual entry or TMDB genre names) into
 * genre ids, upserting by slug — matching by slug (not the raw name string)
 * collapses case/accent-only variants ("Ação" vs "ação") into one row,
 * mirroring prisma/seed.ts's upsert-by-slug pattern. Deduped and run
 * sequentially so two names that collapse to the same slug in one call
 * don't race each other into a unique-constraint error.
 */
export async function upsertGenresByName(
  names: string[],
): Promise<{ id: string; name: string; slug: string }[]> {
  const uniqueBySlug = new Map(names.map((name) => [slugify(name), name]));

  const genres: { id: string; name: string; slug: string }[] = [];
  for (const [slug, name] of uniqueBySlug) {
    genres.push(await upsertGenreBySlug({ name, slug }));
  }
  return genres;
}
