import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ToggleActiveButton } from "@/features/admin/components/ToggleActiveButton";
import { AGE_RATING_LABELS } from "@/repositories/content.mapper";
import { listMoviesForAdmin } from "@/services/movie.service";
import { toggleMovieActiveAction } from "./actions";

export const metadata: Metadata = { title: "Filmes — Painel administrativo" };

export default async function AdminMoviesPage() {
  const movies = await listMoviesForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-foreground text-2xl font-semibold">Filmes</h1>
        <Link href="/admin/movies/new">
          <Button type="button">Novo filme</Button>
        </Link>
      </div>

      {movies.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum filme cadastrado ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {movies.map((movie) => (
            <li
              key={movie.id}
              className="border-border flex items-center justify-between gap-4 rounded-md border p-4"
            >
              <div>
                <p className="text-foreground font-medium">
                  {movie.title}{" "}
                  <span className="text-muted-foreground text-sm">
                    ({movie.releaseYear}, {AGE_RATING_LABELS[movie.ageRating]},{" "}
                    {movie.durationInMinutes}min)
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  {movie.genres.map((genre) => genre.name).join(", ") || "Sem gênero"} —{" "}
                  {movie.isActive ? "Ativo" : "Inativo"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/admin/movies/${movie.id}/edit`}>
                  <Button type="button" variant="ghost">
                    Editar
                  </Button>
                </Link>
                <ToggleActiveButton
                  id={movie.id}
                  isActive={movie.isActive}
                  action={toggleMovieActiveAction}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
