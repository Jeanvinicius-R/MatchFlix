"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterUrl: string | null;
}

interface TmdbSearchPickerProps {
  type: "movie" | "series";
  onPick: (tmdbId: number) => void;
  disabled?: boolean;
}

const DEBOUNCE_MS = 350;

/**
 * Dumb search box: only lists TMDB matches and reports which one was picked.
 * Fetching full details (and deciding what to prefill) is the caller's job —
 * that differs meaningfully between MovieForm and SeriesForm.
 */
export function TmdbSearchPicker({ type, onPick, disabled }: TmdbSearchPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pickedId, setPickedId] = useState<number | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/tmdb/search?type=${type}&query=${encodeURIComponent(trimmed)}`,
        );
        const data = await response.json();
        setResults(response.ok ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [query, type]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        label={type === "movie" ? "Buscar na TMDB (filme)" : "Buscar na TMDB (série)"}
        type="text"
        placeholder="Digite um título..."
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />

      {isSearching && <p className="text-muted-foreground text-xs">Buscando...</p>}

      {query.trim() && results.length > 0 && (
        <ul className="border-border max-h-64 overflow-y-auto rounded-md border">
          {results.map((result) => (
            <li key={result.tmdbId}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setPickedId(result.tmdbId);
                  onPick(result.tmdbId);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-white/10",
                  pickedId === result.tmdbId && "bg-accent/20",
                )}
              >
                {result.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external TMDB thumbnail, not worth next/image config for an admin-only picker
                  <img
                    src={result.posterUrl}
                    alt=""
                    className="h-12 w-8 rounded object-cover"
                  />
                ) : (
                  <span className="h-12 w-8 rounded bg-white/10" />
                )}
                <span className="text-foreground">
                  {result.title}
                  {result.releaseYear && (
                    <span className="text-muted-foreground"> ({result.releaseYear})</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
