import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/layout/Logo";
import { CreateProfileForm } from "@/features/profiles/components/CreateProfileForm";
import { listProfiles } from "@/services/profile.service";

export const metadata: Metadata = { title: "Novo perfil — MatchFlix" };

const MAX_PROFILES = 5;

export default async function NewProfilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const profiles = await listProfiles(session.user.id);
  if (profiles.length >= MAX_PROFILES) {
    redirect("/profiles");
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-16">
      <div className="border-border bg-surface/60 w-full max-w-sm rounded-xl border p-8 backdrop-blur-lg">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-foreground mb-6 text-center text-xl font-semibold">
          Novo perfil
        </h1>
        <CreateProfileForm />
      </div>
    </main>
  );
}
