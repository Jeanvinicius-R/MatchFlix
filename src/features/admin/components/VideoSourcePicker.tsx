"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

export interface VideoSourceProviderOption {
  id: string;
  label: string;
}

export interface VideoSourceFileOption {
  fileName: string;
  label: string;
}

export interface PickedVideoSource {
  providerId: string;
  itemId: string;
  files: VideoSourceFileOption[];
}

interface SourceItem {
  itemId: string;
  title: string;
  year: number | null;
}

interface VideoSourcePickerProps {
  providers: VideoSourceProviderOption[];
  initialQuery: string;
  /** Ask the server to de-duplicate and name-sort files so they map onto episodes in order. */
  forEpisodes?: boolean;
  /** Called with the chosen item and its files, or null when the choice is cleared. */
  onPick: (picked: PickedVideoSource | null) => void;
}

const DEBOUNCE_MS = 400;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Provider + title search + file listing. What to do with the files is up to the caller. */
export function VideoSourcePicker({
  providers,
  initialQuery,
  forEpisodes = false,
  onPick,
}: VideoSourcePickerProps) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pickedItemId, setPickedItemId] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !providerId) {
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      const data = await fetchJson<{ results: SourceItem[] }>(
        `/api/video-sources/search?provider=${providerId}&query=${encodeURIComponent(trimmed)}`,
      );
      if (!cancelled) {
        setItems(data?.results ?? []);
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, providerId]);

  async function handlePickItem(itemId: string) {
    setPickedItemId(itemId);
    setError(null);
    onPick(null);
    setIsLoadingFiles(true);

    const data = await fetchJson<{ files: VideoSourceFileOption[] }>(
      `/api/video-sources/files?provider=${providerId}&itemId=${encodeURIComponent(itemId)}${
        forEpisodes ? "&for=episodes" : ""
      }`,
    );
    setIsLoadingFiles(false);

    if (!data) {
      setError("Não foi possível listar os arquivos.");
      return;
    }
    if (data.files.length === 0) {
      setError(
        "Este item não tem arquivos que o navegador consiga tocar (MP4, WebM ou OGV).",
      );
      return;
    }
    onPick({ providerId, itemId, files: data.files });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
        <Select
          label="Fonte"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            setItems([]);
            setPickedItemId(null);
            setError(null);
            onPick(null);
          }}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </Select>
        <Input
          label="Buscar título na fonte"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {isSearching && <p className="text-muted-foreground text-xs">Buscando...</p>}

      {query.trim() && items.length > 0 && (
        <ul className="border-border max-h-64 overflow-y-auto rounded-md border">
          {items.map((item) => (
            <li key={item.itemId}>
              <button
                type="button"
                onClick={() => handlePickItem(item.itemId)}
                className={cn(
                  "text-foreground hover:bg-tint/10 w-full px-3 py-2 text-left text-sm transition-colors",
                  pickedItemId === item.itemId && "bg-accent/20",
                )}
              >
                {item.title}
                {item.year && (
                  <span className="text-muted-foreground"> ({item.year})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isSearching && query.trim() && items.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Nenhum resultado. Tente outro termo ou outra fonte.
        </p>
      )}

      {isLoadingFiles && (
        <p className="text-muted-foreground text-xs">Carregando arquivos...</p>
      )}

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
