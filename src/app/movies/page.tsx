import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { ContentGrid } from "@/features/home/components/ContentGrid";
import { getBrowsingContext } from "@/lib/browsing-context";
import { getMovieCatalog } from "@/services/content.service";

export const metadata: Metadata = { title: "Filmes — MatchFlix" };

export default async function MoviesPage() {
  const { kidsOnly } = await getBrowsingContext();
  const movies = await getMovieCatalog(kidsOnly);

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 pt-28 pb-16 sm:px-8 md:pt-24">
        <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
          Filmes
        </h1>
        <ContentGrid items={movies} emptyMessage="Nenhum filme disponível ainda." />
      </main>
    </>
  );
}
