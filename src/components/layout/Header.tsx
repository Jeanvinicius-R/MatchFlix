import { auth } from "@/lib/auth";
import { getActiveProfile } from "@/services/profile.service";
import { PRIMARY_NAVIGATION } from "@/constants/navigation.constants";
import { Logo } from "@/components/layout/Logo";
import { SearchInput } from "@/components/layout/SearchInput";
import { AuthHeaderActions } from "@/features/auth/components/AuthHeaderActions";

export async function Header() {
  const session = await auth();
  const activeProfile = session?.user ? await getActiveProfile(session.user.id) : null;

  return (
    <header className="border-border/60 bg-background/70 fixed inset-x-0 top-0 z-50 border-b backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-6 px-4 sm:px-8">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Navegação principal" className="hidden md:block">
            <ul className="text-muted-foreground flex items-center gap-6 text-sm">
              {PRIMARY_NAVIGATION.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="hover:text-foreground transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <SearchInput />
          <AuthHeaderActions
            userName={session?.user?.name ?? null}
            profileName={activeProfile?.name ?? null}
            role={session?.user?.role ?? null}
          />
        </div>
      </div>
    </header>
  );
}
