import type { Metadata } from "next";
import { MovieForm } from "@/features/admin/components/MovieForm";
import { listGenresForAdmin } from "@/services/genre.service";

export const metadata: Metadata = { title: "Novo filme — Painel administrativo" };

export default async function NewMoviePage() {
  const genres = await listGenresForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-foreground text-2xl font-semibold">Novo filme</h1>
      <MovieForm mode="create" existingGenres={genres} />
    </div>
  );
}
