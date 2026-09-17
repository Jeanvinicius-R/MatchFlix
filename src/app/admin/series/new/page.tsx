import type { Metadata } from "next";
import { SeriesForm } from "@/features/admin/components/SeriesForm";
import { listGenresForAdmin } from "@/services/genre.service";

export const metadata: Metadata = { title: "Nova série — Painel administrativo" };

export default async function NewSeriesPage() {
  const genres = await listGenresForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-foreground text-2xl font-semibold">Nova série</h1>
      <SeriesForm mode="create" existingGenres={genres} />
    </div>
  );
}
