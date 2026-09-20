import { Settings } from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/features/auth/components/LogoutButton";

interface AuthHeaderActionsProps {
  userName: string | null;
  profileName: string | null;
  role: "USER" | "ADMIN" | null;
}

export function AuthHeaderActions({
  userName,
  profileName,
  role,
}: AuthHeaderActionsProps) {
  if (!userName) {
    return (
      <Link
        href="/login"
        className="text-foreground hover:bg-tint/10 rounded-md px-3 py-2 text-sm font-medium transition-colors"
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
      {role === "ADMIN" && (
        <Link
          href="/admin/movies"
          className="text-muted-foreground hover:text-foreground hidden text-sm transition-colors sm:inline"
        >
          Painel administrativo
        </Link>
      )}
      <Link
        href="/settings"
        aria-label="Configurações"
        title="Configurações"
        className="border-border bg-surface-elevated text-muted-foreground hover:border-accent/60 hover:text-foreground flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
      >
        <Settings size={16} aria-hidden="true" />
      </Link>
      <LogoutButton />
    </div>
  );
}
