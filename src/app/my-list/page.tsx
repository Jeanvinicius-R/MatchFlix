import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { ContentGrid } from "@/features/home/components/ContentGrid";
import { requireProfile } from "@/lib/require-profile";
import { getMyList } from "@/services/favorite.service";

export const metadata: Metadata = { title: "Minha lista — MatchFlix" };

export default async function MyListPage() {
  const profile = await requireProfile();
  const items = await getMyList(profile.id, profile.isKids);

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 pt-28 pb-16 sm:px-8 md:pt-24">
        <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
          Minha lista
        </h1>
        <ContentGrid
          items={items}
          emptyMessage='Sua lista está vazia. Abra um filme ou série e toque em "Minha lista" para salvá-lo aqui.'
        />
      </main>
    </>
  );
}
