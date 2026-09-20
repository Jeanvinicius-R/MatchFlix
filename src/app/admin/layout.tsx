import Link from "next/link";
import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { requireAdmin } from "@/lib/require-admin";

const ADMIN_NAV_LINKS = [
  { href: "/admin/movies", label: "Filmes" },
  { href: "/admin/series", label: "Séries" },
  { href: "/admin/genres", label: "Gêneros" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 pt-28 pb-16 sm:px-8 md:pt-24">
        <nav aria-label="Painel administrativo">
          <ul className="border-border flex gap-6 border-b pb-4 text-sm">
            {ADMIN_NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </main>
    </>
  );
}
