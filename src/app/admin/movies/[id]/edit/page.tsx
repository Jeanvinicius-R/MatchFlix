import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { applyMovieImagesAction } from "@/app/admin/movies/actions";
import { ContentImagesSection } from "@/features/admin/components/ContentImagesSection";
import { MovieForm } from "@/features/admin/components/MovieForm";
import { MovieVideoSection } from "@/features/admin/components/MovieVideoSection";
import { listGenresForAdmin } from "@/services/genre.service";
import { getMovieForAdmin, MovieNotFoundError } from "@/services/movie.service";
import { listVideoSourceProviders } from "@/services/video-sources";

export const metadata: Metadata = { title: "Editar filme — Painel administrativo" };

interface EditMoviePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMoviePage({ params }: EditMoviePageProps) {
  const { id } = await params;

  const [movie, genres] = await Promise.all([
    getMovieForAdmin(id).catch((error) => {
      if (error instanceof MovieNotFoundError) {
        notFound();
      }
      throw error;
    }),
    listGenresForAdmin(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-foreground text-2xl font-semibold">
        Editar filme — {movie.title}
      </h1>
      <MovieForm mode="edit" movie={movie} existingGenres={genres} />
      <ContentImagesSection
        kind="movie"
        contentId={movie.id}
        contentTitle={movie.title}
        posterUrl={movie.poster?.url ?? null}
        backdropUrl={movie.backdrop?.url ?? null}
        applyImages={applyMovieImagesAction}
      />
      <MovieVideoSection
        movieId={movie.id}
        movieTitle={movie.title}
        providers={listVideoSourceProviders().map(({ id, label }) => ({ id, label }))}
        currentVideo={movie.video}
      />
    </div>
  );
}
