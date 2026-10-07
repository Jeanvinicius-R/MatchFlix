import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ProfileAvatar } from "@/features/profiles/components/ProfileAvatar";
import { auth } from "@/lib/auth";
import { listProfiles } from "@/services/profile.service";

export const metadata: Metadata = { title: "Gerenciar perfis — MatchFlix" };

const MAX_PROFILES = 5;

export default async function ManageProfilesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?next=%2Fprofiles%2Fmanage");
  }

  const profiles = await listProfiles(session.user.id);

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center gap-10 px-4 py-16">
      <Logo />
      <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
        Gerenciar perfis
      </h1>

      <ul className="flex flex-wrap items-start justify-center gap-x-8 gap-y-10">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <Link
              href={`/profiles/${profile.id}/edit`}
              className="group flex flex-col items-center gap-3"
              aria-label={`Editar perfil ${profile.name}`}
            >
              <span className="relative rounded-full transition-transform group-hover:scale-105">
                <ProfileAvatar
                  name={profile.name}
                  isKids={profile.isKids}
                  imageUrl={profile.avatarUrl}
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white">
                  <Pencil size={24} aria-hidden="true" />
                </span>
              </span>
              <span className="text-muted-foreground group-hover:text-foreground text-sm transition-colors">
                {profile.name}
              </span>
            </Link>
          </li>
        ))}

        {profiles.length < MAX_PROFILES && (
          <li>
            <Link href="/profiles/new" className="group flex flex-col items-center gap-3">
              <span className="border-border text-muted-foreground group-hover:border-accent/60 group-hover:text-foreground flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed transition-colors sm:h-28 sm:w-28">
                <Plus size={28} aria-hidden="true" />
              </span>
              <span className="text-muted-foreground group-hover:text-foreground text-sm transition-colors">
                Adicionar perfil
              </span>
            </Link>
          </li>
        )}
      </ul>

      <Link
        href="/profiles"
        className="bg-accent text-accent-foreground hover:bg-accent-strong rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
      >
        Concluído
      </Link>
    </main>
  );
}
