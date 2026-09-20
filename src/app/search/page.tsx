import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { ContentGrid } from "@/features/home/components/ContentGrid";
import { getBrowsingContext } from "@/lib/browsing-context";
import { searchCatalog } from "@/services/content.service";

export const metadata: Metadata = { title: "Busca — MatchFlix" };

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";

  const { kidsOnly } = await getBrowsingContext();
  const results = await searchCatalog(query, kidsOnly);

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 pt-28 pb-16 sm:px-8 md:pt-24">
        <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
          {query ? `Resultados para “${query}”` : "Busca"}
        </h1>
        <ContentGrid
          items={results}
          emptyMessage={
            query.length < 2
              ? "Digite pelo menos 2 letras na busca."
              : `Nada encontrado para “${query}”. Tente outro título.`
          }
        />
      </main>
    </>
  );
}
