export interface NavigationLink {
  label: string;
  href: string;
}

/** Primary navigation shown in the header (desktop) and under it (mobile). */
export const PRIMARY_NAVIGATION: NavigationLink[] = [
  { label: "Início", href: "/" },
  { label: "Filmes", href: "/movies" },
  { label: "Séries", href: "/series" },
  { label: "Minha lista", href: "/my-list" },
];
