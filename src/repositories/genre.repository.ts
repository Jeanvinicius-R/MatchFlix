import { prisma } from "@/lib/prisma";

export interface AdminGenreRecord {
  id: string;
  name: string;
  slug: string;
  _count: { movies: number; series: number };
}

export function findAllGenres(): Promise<AdminGenreRecord[]> {
  return prisma.genre.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { movies: true, series: true } },
    },
  });
}

export function findGenreById(id: string) {
  return prisma.genre.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true },
  });
}

export function findGenreBySlug(slug: string) {
  return prisma.genre.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
}

export function createGenre(data: { name: string; slug: string }) {
  return prisma.genre.create({
    data,
    select: { id: true, name: true, slug: true },
  });
}

export function updateGenre(id: string, data: { name: string; slug: string }) {
  return prisma.genre.update({
    where: { id },
    data,
    select: { id: true, name: true, slug: true },
  });
}

export async function deleteGenre(id: string): Promise<void> {
  await prisma.genre.delete({ where: { id } });
}

export function upsertGenreBySlug(data: { name: string; slug: string }) {
  return prisma.genre.upsert({
    where: { slug: data.slug },
    update: {},
    create: data,
    select: { id: true, name: true, slug: true },
  });
}
