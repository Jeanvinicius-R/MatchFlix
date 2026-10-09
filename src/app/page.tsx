import { Header } from "@/components/layout/Header";
import { getBrowsingContext } from "@/lib/browsing-context";
import { HeroBanner } from "@/features/home/components/HeroBanner";
import { ContentRow } from "@/features/home/components/ContentRow";
import {
  getContinueWatchingRow,
  getHeroHighlight,
  getHomeContentRows,
} from "@/services/content.service";

export default async function HomePage() {
  const { kidsOnly, profileId } = await getBrowsingContext();

  const [heroContent, contentRows, continueWatchingRow] = await Promise.all([
    getHeroHighlight(kidsOnly),
    getHomeContentRows(kidsOnly),
    getContinueWatchingRow(profileId, kidsOnly),
  ]);

  const rows = continueWatchingRow ? [continueWatchingRow, ...contentRows] : contentRows;

  return (
    <>
      <Header />
      <main>
        {heroContent ? (
          <HeroBanner content={heroContent} />
        ) : (
          <section className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 pt-36 pb-8 text-center">
            <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
              {kidsOnly
                ? "Nada para o perfil infantil por enquanto"
                : "O catálogo ainda está vazio"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {kidsOnly
                ? "Ainda não há títulos com classificação livre (L)."
                : "Quando títulos forem cadastrados no painel administrativo, eles aparecem aqui."}
            </p>
          </section>
        )}
        <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-4 py-12 sm:px-8 sm:py-16">
          {rows.map((row) => (
            <ContentRow key={row.id} row={row} />
          ))}
        </div>
      </main>
    </>
  );
}
