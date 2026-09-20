"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAVIGATION } from "@/constants/navigation.constants";
import { cn } from "@/lib/utils";

interface PrimaryNavProps {
  /** "desktop" sits beside the logo; "mobile" is a scrollable second row under the header. */
  variant: "desktop" | "mobile";
}

function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav({ variant }: PrimaryNavProps) {
  const pathname = usePathname();

  const links = PRIMARY_NAVIGATION.map((link) => {
    const active = isActive(pathname, link.href);
    return (
      <li key={link.href} className="shrink-0">
        <Link
          href={link.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "transition-colors",
            active
              ? "text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {link.label}
        </Link>
      </li>
    );
  });

  if (variant === "mobile") {
    return (
      <nav
        aria-label="Navegação principal (celular)"
        className="border-border/60 border-t md:hidden"
      >
        <ul className="flex h-10 scrollbar-none items-center gap-6 overflow-x-auto px-4 text-sm">
          {links}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Navegação principal" className="hidden md:block">
      <ul className="flex items-center gap-6 text-sm">{links}</ul>
    </nav>
  );
}
