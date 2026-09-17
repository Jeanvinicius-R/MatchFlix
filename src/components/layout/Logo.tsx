import { siteConfig } from "@/config/site.config";

export function Logo() {
  return (
    <span
      className="font-display text-foreground flex items-center gap-2 text-2xl font-semibold tracking-wide"
      aria-label={siteConfig.name}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M3 21 12 3l9 18" stroke="var(--color-accent)" strokeWidth="1.6" />
        <path d="M12 3v18" stroke="var(--color-accent)" strokeWidth="1.6" />
      </svg>
      {siteConfig.name}
    </span>
  );
}
