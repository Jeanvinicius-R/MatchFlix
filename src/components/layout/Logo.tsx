import { siteConfig } from "@/config/site.config";

/**
 * Marca do MatchFlix: chama preta com um play verde dentro. O contorno verde
 * mantém a chama visível sobre o fundo preto do tema escuro; no claro ela
 * aparece como uma silhueta preta. Mantenha o desenho em sincronia com app/icon.svg.
 */
export function FlameMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 40" fill="none" aria-hidden="true" className={className}>
      <path
        d="M16 2C17 9 26 13 26 25C26 33 21.5 38 16 38C10.5 38 6 33 6 25C6 20 8.5 16.5 11 14C11.5 17 13 18.5 14.5 18.5C14 13 14 7 16 2Z"
        fill="var(--color-flame)"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13.5 21.5V32.5L22.5 27Z" fill="var(--color-accent)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span
      className="text-foreground flex items-center gap-2 text-2xl font-extrabold tracking-tight"
      aria-label={siteConfig.name}
    >
      <FlameMark className="h-8 w-[26px] shrink-0" />
      <span aria-hidden="true">
        Match<span className="text-accent">Flix</span>
      </span>
    </span>
  );
}
