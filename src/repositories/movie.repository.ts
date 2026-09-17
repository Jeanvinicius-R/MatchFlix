import type { AgeRating } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

const ADMIN_MOVIE_SELECT = {
  id: true,
  slug: true,
  title: true,
  originalTitle: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  durationInMinutes: true,
  isActive: true,
  genres: { select: { id: true, name: true, slug: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export type AdminMovieRecord = Awaited<ReturnType<typeof findMovieByIdForAdmin>>;

interface MovieScalarInput {
  title: string;
  originalTitle: string | null;
  synopsis: string;
  releaseYear: number;
  ageRating: AgeRating;
  durationInMinutes: number;
}

export function findAllMoviesForAdmin() {
  return prisma.movie.findMany({
    orderBy: { title: "asc" },
    select: ADMIN_MOVIE_SELECT,
  });
}

export function findMovieByIdForAdmin(id: string) {
  return prisma.movie.findUnique({ where: { id }, select: ADMIN_MOVIE_SELECT });
}

export function findMovieBySlug(slug: string) {
  return prisma.movie.findUnique({ where: { slug }, select: { id: true } });
}

export function createMovie(
  data: MovieScalarInput & { slug: string; genreIds: string[] },
) {
  const { genreIds, ...scalars } = data;
  return prisma.movie.create({
    data: { ...scalars, genres: { connect: genreIds.map((id) => ({ id })) } },
    select: ADMIN_MOVIE_SELECT,
  });
}

export function updateMovie(
  id: string,
  data: MovieScalarInput & { slug: string; genreIds: string[] },
) {
  const { genreIds, ...scalars } = data;
  return prisma.movie.update({
    where: { id },
    data: { ...scalars, genres: { set: genreIds.map((id) => ({ id })) } },
    select: ADMIN_MOVIE_SELECT,
  });
}

export async function setMovieActive(id: string, isActive: boolean): Promise<void> {
  await prisma.movie.update({ where: { id }, data: { isActive } });
}
