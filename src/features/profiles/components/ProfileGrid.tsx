import { Plus } from "lucide-react";
import Link from "next/link";
import { withNext } from "@/lib/next-path";
import { ProfileAvatar } from "@/features/profiles/components/ProfileAvatar";
import type { ProfileSummary } from "@/types/profile.types";

const MAX_PROFILES = 5;

interface ProfileGridProps {
  profiles: ProfileSummary[];
  /** Where to go once a profile is picked (defaults to the home page). */
  next?: string | null;
}

export function ProfileGrid({ profiles, next = null }: ProfileGridProps) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-10">
      {profiles.map((profile) => (
        <Link
          key={profile.id}
          href={withNext(`/profiles/select/${profile.id}`, next)}
          className="group flex flex-col items-center gap-3"
        >
          <span className="rounded-full transition-transform group-hover:scale-105">
            <ProfileAvatar name={profile.name} isKids={profile.isKids} />
          </span>
          <span className="text-muted-foreground group-hover:text-foreground text-sm transition-colors">
            {profile.name}
          </span>
        </Link>
      ))}

      {profiles.length < MAX_PROFILES && (
        <Link href="/profiles/new" className="group flex flex-col items-center gap-3">
          <span className="border-border text-muted-foreground group-hover:border-accent/60 group-hover:text-foreground flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed transition-colors sm:h-28 sm:w-28">
            <Plus size={28} aria-hidden="true" />
          </span>
          <span className="text-muted-foreground group-hover:text-foreground text-sm transition-colors">
            Adicionar perfil
          </span>
        </Link>
      )}
    </div>
  );
}
