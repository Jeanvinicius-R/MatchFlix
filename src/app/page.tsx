import { Header } from "@/components/layout/Header";
import { getBrowsingContext } from "@/lib/browsing-context";
import { HeroBanner } from "@/features/home/components/HeroBanner";
import { ContentRow } from "@/features/home/components/ContentRow";
import { getHeroHighlight, getHomeContentRows } from "@/services/content.service";

export default async function HomePage() {
  const { kidsOnly } = await getBrowsingContext();

  const [heroContent, contentRows] = await Promise.all([
    getHeroHighlight(kidsOnly),
    getHomeContentRows(kidsOnly),
  ]);

  return (
    <>
      <Header />
      <main>
        <HeroBanner content={heroContent} />
        <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-4 py-12 sm:px-8 sm:py-16">
          {contentRows.map((row) => (
            <ContentRow key={row.id} row={row} />
          ))}
        </div>
      </main>
    </>
  );
}
