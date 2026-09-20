import Link from "next/link";
import { auth } from "@/lib/auth";
import { getActiveProfile } from "@/services/profile.service";
import { Logo } from "@/components/layout/Logo";
import { PrimaryNav } from "@/components/layout/PrimaryNav";
import { SearchInput } from "@/components/layout/SearchInput";
import { AuthHeaderActions } from "@/features/auth/components/AuthHeaderActions";

export async function Header() {
  const session = await auth();
  const activeProfile = session?.user ? await getActiveProfile(session.user.id) : null;

  return (
    <header className="border-border/60 bg-background/90 fixed inset-x-0 top-0 z-50 border-b backdrop-blur-lg">
      <div className="group/header mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:gap-6 sm:px-8">
        <div className="flex items-center gap-8">
          {/* Below lg the brand steps aside while the search box is open, so everything fits. */}
          <Link
            href="/"
            aria-label="MatchFlix — página inicial"
            className="max-lg:group-has-[input:focus]/header:hidden"
          >
            <Logo />
          </Link>
          <PrimaryNav variant="desktop" />
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <SearchInput />
          <AuthHeaderActions
            userName={session?.user?.name ?? null}
            profileName={activeProfile?.name ?? null}
            role={session?.user?.role ?? null}
          />
        </div>
      </div>
      <PrimaryNav variant="mobile" />
    </header>
  );
}
