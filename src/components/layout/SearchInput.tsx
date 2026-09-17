"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Presentational search field. Submission is intentionally a no-op —
 * content search will be wired up once real content browsing exists.
 */
export function SearchInput() {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <label
      className={cn(
        "border-border text-muted-foreground flex items-center gap-2 rounded-full border bg-white/5 px-3 py-2 text-sm transition-all duration-200",
        isFocused && "border-accent/60 text-foreground bg-white/10",
      )}
    >
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        name="query"
        placeholder="Buscar filmes e séries"
        aria-label="Buscar filmes e séries"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={cn(
          "text-foreground placeholder:text-muted-foreground w-28 bg-transparent focus:outline-none",
          "transition-[width] duration-200",
          isFocused && "w-48",
        )}
      />
    </label>
  );
}
