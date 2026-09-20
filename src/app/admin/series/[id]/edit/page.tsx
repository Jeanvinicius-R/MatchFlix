import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { applySeriesImagesAction } from "@/app/admin/series/actions";
import { ContentImagesSection } from "@/features/admin/components/ContentImagesSection";
import { SeriesEpisodesSection } from "@/features/admin/components/SeriesEpisodesSection";
import { SeriesForm } from "@/features/admin/components/SeriesForm";
import { listGenresForAdmin } from "@/services/genre.service";
import { getSeriesForAdmin, SeriesNotFoundError } from "@/services/series.service";
import { listVideoSourceProviders } from "@/services/video-sources";

export const metadata: Metadata = { title: "Editar série — Painel administrativo" };

interface EditSeriesPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSeriesPage({ params }: EditSeriesPageProps) {
  const { id } = await params;

  const [series, genres] = await Promise.all([
    getSeriesForAdmin(id).catch((error) => {
      if (error instanceof SeriesNotFoundError) {
        notFound();
      }
      throw error;
    }),
    listGenresForAdmin(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-foreground text-2xl font-semibold">
        Editar série — {series.title}
      </h1>
      <SeriesForm mode="edit" series={series} existingGenres={genres} />
      <ContentImagesSection
        kind="series"
        contentId={series.id}
        contentTitle={series.title}
        posterUrl={series.poster?.url ?? null}
        backdropUrl={series.backdrop?.url ?? null}
        applyImages={applySeriesImagesAction}
      />
      <SeriesEpisodesSection
        seriesId={series.id}
        seriesTitle={series.title}
        providers={listVideoSourceProviders().map(({ id, label }) => ({ id, label }))}
        seasons={series.seasons}
      />
    </div>
  );
}
