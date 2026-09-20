"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/constants/theme.constants";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";

/** <html data-theme> is the single source of truth; the inline script in layout.tsx sets it before paint. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode): the theme still applies for this visit.
  }
}

const OPTIONS: { value: Theme; label: string; description: string; Icon: typeof Sun }[] =
  [
    { value: "dark", label: "Escuro", description: "Preto e verde", Icon: Moon },
    { value: "light", label: "Claro", description: "Branco e verde", Icon: Sun },
  ];

export function ThemeSelector() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div role="radiogroup" aria-label="Tema" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map(({ value, label, description, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => applyTheme(value)}
          className={cn(
            "border-border hover:border-accent/60 flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
            theme === value && "border-accent bg-accent/10",
          )}
        >
          <Icon size={20} aria-hidden="true" className="text-accent shrink-0" />
          <span className="flex flex-col">
            <span className="text-foreground text-sm font-medium">{label}</span>
            <span className="text-muted-foreground text-xs">{description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
