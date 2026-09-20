import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { safeNextPath, withNext } from "@/lib/next-path";
import { Logo } from "@/components/layout/Logo";
import { ProfileGrid } from "@/features/profiles/components/ProfileGrid";
import { listProfiles } from "@/services/profile.service";

export const metadata: Metadata = { title: "Quem está assistindo? — MatchFlix" };

interface ProfilesPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function ProfilesPage({ searchParams }: ProfilesPageProps) {
  const next = safeNextPath((await searchParams).next);
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const profiles = await listProfiles(session.user.id);

  // A single profile is the common case (just the account owner) — skip the
  // picker entirely instead of making them click through it every time.
  // The actual cookie write happens in the route handler below: cookies can
  // only be set from a Server Action or Route Handler, never during render.
  if (profiles.length === 1) {
    redirect(withNext(`/profiles/select/${profiles[0].id}`, next));
  }

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center gap-10 px-4 py-16">
      <Logo />
      <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
        Quem está assistindo?
      </h1>
      <ProfileGrid profiles={profiles} next={next} />
    </main>
  );
}
