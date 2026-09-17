import { LogOut } from "lucide-react";
import { logoutAction } from "@/features/auth/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        aria-label="Sair da conta"
        className="border-border bg-surface-elevated text-muted-foreground hover:border-accent/60 hover:text-foreground flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
