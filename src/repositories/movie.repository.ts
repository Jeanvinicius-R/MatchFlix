import type { AgeRating } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  createImageMedia,
  createVideoMedia,
  deleteMediaIfPresent,
  type ImageUrls,
  type VideoMediaInput,
} from "@/repositories/media.repository";

const ADMIN_MOVIE_SELECT = {
  id: true,
  slug: true,
  tmdbId: true,
  title: true,
  originalTitle: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  durationInMinutes: true,
  isActive: true,
  genres: { select: { id: true, name: true, slug: true } },
  video: { select: { url: true, fileName: true, storageProvider: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
  createdAt: true,
  updatedAt: true,
} as const;

const PLAYBACK_MOVIE_SELECT = {
  id: true,
  slug: true,
  tmdbId: true,
  title: true,
  synopsis: true,
  releaseYear: true,
  ageRating: true,
  isActive: true,
  video: { select: { url: true, mimeType: true } },
  poster: { select: { url: true } },
  backdrop: { select: { url: true } },
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

export function findMovieByTmdbId(tmdbId: number) {
  return prisma.movie.findUnique({ where: { tmdbId }, select: { id: true } });
}

export function createMovie(
  data: MovieScalarInput & {
    slug: string;
    genreIds: string[];
    tmdbId: number | null;
  },
) {
  const { genreIds, ...scalars } = data;
  return prisma.movie.create({
    data: { ...scalars, genres: { connect: genreIds.map((id) => ({ id })) } },
    select: ADMIN_MOVIE_SELECT,
  });
}

export function updateMovie(
  id: string,
  data: MovieScalarInput & {
    slug: string;
    genreIds: string[];
    tmdbId?: number;
  },
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

export function findMovieForPlaybackBySlug(slug: string) {
  return prisma.movie.findUnique({ where: { slug }, select: PLAYBACK_MOVIE_SELECT });
}

/**
 * Points the movie at a new video and drops the previous Media row, so
 * replacing a video never leaves orphaned references behind.
 */
export async function setMovieVideo(
  movieId: string,
  video: VideoMediaInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.movie.findUnique({
      where: { id: movieId },
      select: { videoMediaId: true },
    });

    const mediaId = await createVideoMedia(tx, video);
    await tx.movie.update({ where: { id: movieId }, data: { videoMediaId: mediaId } });
    await deleteMediaIfPresent(tx, current?.videoMediaId);
  });
}

export async function clearMovieVideo(movieId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.movie.findUnique({
      where: { id: movieId },
      select: { videoMediaId: true },
    });

    await tx.movie.update({ where: { id: movieId }, data: { videoMediaId: null } });
    await deleteMediaIfPresent(tx, current?.videoMediaId);
  });
}

/**
 * Replaces the movie's poster and/or backdrop. A null/undefined URL leaves
 * that image as it is, so a title TMDB has no backdrop for keeps the old one.
 */
export async function setMovieImages(
  movieId: string,
  { posterUrl, backdropUrl }: ImageUrls,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.movie.findUnique({
      where: { id: movieId },
      select: { posterMediaId: true, backdropMediaId: true },
    });

    if (posterUrl) {
      const mediaId = await createImageMedia(tx, "POSTER", posterUrl);
      await tx.movie.update({ where: { id: movieId }, data: { posterMediaId: mediaId } });
      await deleteMediaIfPresent(tx, current?.posterMediaId);
    }
    if (backdropUrl) {
      const mediaId = await createImageMedia(tx, "BACKDROP", backdropUrl);
      await tx.movie.update({
        where: { id: movieId },
        data: { backdropMediaId: mediaId },
      });
      await deleteMediaIfPresent(tx, current?.backdropMediaId);
    }
  });
}
