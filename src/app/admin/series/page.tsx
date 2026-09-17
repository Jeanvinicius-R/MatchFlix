import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ToggleActiveButton } from "@/features/admin/components/ToggleActiveButton";
import { AGE_RATING_LABELS } from "@/repositories/content.mapper";
import { listSeriesForAdmin } from "@/services/series.service";
import { toggleSeriesActiveAction } from "./actions";

export const metadata: Metadata = { title: "Séries — Painel administrativo" };

export default async function AdminSeriesPage() {
  const series = await listSeriesForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-foreground text-2xl font-semibold">Séries</h1>
        <Link href="/admin/series/new">
          <Button type="button">Nova série</Button>
        </Link>
      </div>

      {series.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma série cadastrada ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {series.map((item) => (
            <li
              key={item.id}
              className="border-border flex items-center justify-between gap-4 rounded-md border p-4"
            >
              <div>
                <p className="text-foreground font-medium">
                  {item.title}{" "}
                  <span className="text-muted-foreground text-sm">
                    ({item.releaseYear}, {AGE_RATING_LABELS[item.ageRating]},{" "}
                    {item._count.seasons} temporada(s))
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  {item.genres.map((genre) => genre.name).join(", ") || "Sem gênero"} —{" "}
                  {item.isActive ? "Ativo" : "Inativo"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/admin/series/${item.id}/edit`}>
                  <Button type="button" variant="ghost">
                    Editar
                  </Button>
                </Link>
                <ToggleActiveButton
                  id={item.id}
                  isActive={item.isActive}
                  action={toggleSeriesActiveAction}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
