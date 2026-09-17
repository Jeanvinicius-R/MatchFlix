import type { Metadata } from "next";
import { GenreManager } from "@/features/admin/components/GenreManager";
import { listGenresForAdmin } from "@/services/genre.service";

export const metadata: Metadata = { title: "Gêneros — Painel administrativo" };

export default async function AdminGenresPage() {
  const genres = await listGenresForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-foreground text-2xl font-semibold">Gêneros</h1>
      <GenreManager genres={genres} />
    </div>
  );
}
