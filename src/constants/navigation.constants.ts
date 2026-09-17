export interface NavigationLink {
  label: string;
  href: string;
}

/**
 * Static navigation for the primary header. Targets are placeholders
 * (`#`) until the corresponding routes exist in a later stage.
 */
export const PRIMARY_NAVIGATION: NavigationLink[] = [
  { label: "Início", href: "#" },
  { label: "Filmes", href: "#" },
  { label: "Séries", href: "#" },
  { label: "Minha lista", href: "#" },
];
