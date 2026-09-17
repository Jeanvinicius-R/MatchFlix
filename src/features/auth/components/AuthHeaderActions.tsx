import Link from "next/link";
import { LogoutButton } from "@/features/auth/components/LogoutButton";

interface AuthHeaderActionsProps {
  userName: string | null;
  profileName: string | null;
}

export function AuthHeaderActions({ userName, profileName }: AuthHeaderActionsProps) {
  if (!userName) {
    return (
      <Link
        href="/login"
        className="text-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10"
      >
        Entrar
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {profileName && (
        <Link
          href="/profiles"
          className="text-muted-foreground hover:text-foreground hidden text-sm transition-colors sm:inline"
        >
          {profileName}
        </Link>
      )}
      <LogoutButton />
    </div>
  );
}
