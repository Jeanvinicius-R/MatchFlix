import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/layout/Logo";
import { EditProfileForm } from "@/features/profiles/components/EditProfileForm";
import { auth } from "@/lib/auth";
import { getOwnedProfile, listProfiles, ProfileNotOwnedError } from "@/services/profile.service";

export const metadata: Metadata = { title: "Editar perfil — MatchFlix" };

interface EditProfilePageProps {
  params: Promise<{ profileId: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditProfilePage({ params }: EditProfilePageProps) {
  const { profileId } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect("/login?next=%2Fprofiles%2Fmanage");
  }
  if (!UUID_PATTERN.test(profileId)) {
    notFound();
  }

  const [profile, profiles] = await Promise.all([
    getOwnedProfile(session.user.id, profileId).catch((error) => {
      if (error instanceof ProfileNotOwnedError) {
        notFound();
      }
      throw error;
    }),
    listProfiles(session.user.id),
  ]);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-16">
      <div className="border-border bg-surface/60 w-full max-w-sm rounded-xl border p-8 backdrop-blur-lg">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-foreground mb-6 text-center text-xl font-semibold">
          Editar perfil
        </h1>
        <EditProfileForm profile={profile} canDelete={profiles.length > 1} />
      </div>
    </main>
  );
}
