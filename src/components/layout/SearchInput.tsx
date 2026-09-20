"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Submits to /search?q=... (client-side navigation, and it still works without JS).
 * Below the lg breakpoint it starts as just the icon and expands when tapped, so the header fits.
 */
export function SearchInput() {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Form action="/search" role="search">
      <label
        className={cn(
          "border-border text-muted-foreground bg-tint/5 flex items-center rounded-full border px-3 py-2 text-sm transition-all duration-200 lg:gap-2",
          isFocused && "border-accent/60 text-foreground bg-tint/10 gap-2",
        )}
      >
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          name="q"
          placeholder="Buscar filmes e séries"
          aria-label="Buscar filmes e séries"
          autoComplete="off"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className={cn(
            "text-foreground placeholder:text-muted-foreground w-0 bg-transparent focus:outline-none lg:w-28",
            "transition-[width] duration-200",
            isFocused && "w-36 lg:w-48",
          )}
        />
      </label>
    </Form>
  );
}
