import { prisma } from "@/lib/prisma";
import {
  listLibraryFiles,
  clearLibraryCache,
  type LibraryFile,
} from "@/lib/media-library";
import { attachVideoToMovie } from "@/services/movie.service";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "in",
  "to",
  "e",
  "o",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "um",
  "uma",
]);

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token && !STOPWORDS.has(token));
}

function yearsIn(text: string): Set<number> {
  return new Set((normalize(text).match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number));
}

export interface LibraryLinkReport {
  linked: { title: string; file: string }[];
  /** More than one movie could own the same file — left alone on purpose. */
  ambiguous: { file: string; movies: string[] }[];
  /** Files in the folder that no catalog movie claimed. */
  unmatchedFiles: string[];
  /** Catalog movies still without a video after the scan. */
  stillWithoutVideo: number;
  totalFiles: number;
}

/**
 * Links each catalog movie that has no video yet to a file in the library folder.
 * A file belongs to a movie when its name contains the movie's release year AND every
 * significant word of the title (Portuguese or original). Requiring the year is what
 * keeps "Fast Five (2011)" from being taken for "Furious 7 (2015)".
 */
export async function linkLibraryFilesToMovies(): Promise<LibraryLinkReport> {
  clearLibraryCache();
  const files = await listLibraryFiles();

  const movies = await prisma.movie.findMany({
    where: { isActive: true, videoMediaId: null },
    select: { id: true, title: true, originalTitle: true, releaseYear: true },
  });

  const fileInfo = files.map((file) => {
    const name = normalize(file.relativePath);
    return {
      file,
      name,
      tokens: new Set(name.split(" ")),
      years: yearsIn(file.relativePath),
    };
  });

  const claims = new Map<string, { movieId: string; title: string }[]>();
  const moviesByFile = new Map<string, LibraryFile>();

  for (const movie of movies) {
    const titleVariants = [movie.title, movie.originalTitle].filter((t): t is string =>
      Boolean(t),
    );
    const matching = fileInfo.filter(({ tokens, years }) => {
      if (!years.has(movie.releaseYear)) return false;
      return titleVariants.some((variant) => {
        const wanted = significantTokens(variant);
        return wanted.length > 0 && wanted.every((token) => tokens.has(token));
      });
    });
    // Several files for one movie (e.g. 720p and 1080p): take the largest.
    const best = matching.sort((a, b) => b.file.sizeInBytes - a.file.sizeInBytes)[0];
    if (best) {
      moviesByFile.set(movie.id, best.file);
      const list = claims.get(best.file.relativePath) ?? [];
      list.push({ movieId: movie.id, title: movie.title });
      claims.set(best.file.relativePath, list);
    }
  }

  const report: LibraryLinkReport = {
    linked: [],
    ambiguous: [],
    unmatchedFiles: [],
    stillWithoutVideo: 0,
    totalFiles: files.length,
  };

  for (const [relativePath, owners] of claims) {
    if (owners.length > 1) {
      report.ambiguous.push({ file: relativePath, movies: owners.map((o) => o.title) });
      continue;
    }
    const [owner] = owners;
    await attachVideoToMovie(owner.movieId, {
      provider: "my-files",
      itemId: relativePath,
      fileName: relativePath,
    });
    report.linked.push({ title: owner.title, file: relativePath });
  }

  report.unmatchedFiles = files.map((f) => f.relativePath).filter((p) => !claims.has(p));
  report.stillWithoutVideo = await prisma.movie.count({
    where: { isActive: true, videoMediaId: null },
  });
  return report;
}
