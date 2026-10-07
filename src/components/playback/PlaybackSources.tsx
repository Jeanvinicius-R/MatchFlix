"use client";

import { useCallback, useEffect, useState } from "react";
import PlaybackPlayer from "@/components/playback/PlaybackPlayer";
import type { WatchTarget } from "@/components/playback/playback-target";
import { cn } from "@/lib/utils";
import type { PlaybackSource } from "@/services/playback/playback.types";

interface PlaybackSourcesProps {
  /** `/api/playback/movie/<tmdbId>` or `/api/playback/tv/<tmdbId>/<season>/<episode>`. */
  endpoint: string;
  target: WatchTarget;
  resumeAt?: number;
  nextHref?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; sources: PlaybackSource[] };

function Placeholder({ children, busy = false }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div
      aria-busy={busy}
      className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-black px-4 text-center text-sm text-white"
    >
      {children}
    </div>
  );
}

/**
 * Asks the PlaybackResolver (through the API) which sources exist for a
 * movie/episode, plays the first one and lets the viewer switch between them.
 */
export default function PlaybackSources({
  endpoint,
  target,
  resumeAt = 0,
  nextHref,
}: PlaybackSourcesProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as { sources?: PlaybackSource[] };
        if (!cancelled) {
          const sources = data.sources ?? [];
          setState({ status: "ready", sources });
          setSelectedId(sources[0]?.id ?? null);
        }
      })
      .catch((error) => {
        console.error("Erro ao carregar fontes de reprodução:", error);
        if (!cancelled) {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  if (state.status === "loading") {
    return (
      <Placeholder busy>
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white"
        />
        <p role="status">Procurando fontes de reprodução...</p>
      </Placeholder>
    );
  }

  if (state.status === "error") {
    return (
      <Placeholder>
        <p role="alert">Não foi possível carregar o vídeo.</p>
        <button
          type="button"
          onClick={retry}
          className="rounded bg-white/10 px-4 py-2 transition-colors hover:bg-white/20"
        >
          Tentar de novo
        </button>
      </Placeholder>
    );
  }

  if (state.sources.length === 0) {
    return (
      <Placeholder>
        <p>Nenhuma fonte de reprodução autorizada está disponível para este título.</p>
        <p className="text-sm text-white/70">
          Veja abaixo, em &quot;Onde assistir&quot;, os serviços que oferecem este título.
        </p>
      </Placeholder>
    );
  }

  const selected =
    state.sources.find((source) => source.id === selectedId) ?? state.sources[0];

  return (
    <div className="flex flex-col gap-3">
      <PlaybackPlayer
        source={selected}
        target={target}
        resumeAt={resumeAt}
        nextHref={nextHref}
      />

      {state.sources.length > 1 && (
        <div role="group" aria-label="Fontes de reprodução" className="flex flex-wrap gap-2">
          {state.sources.map((source) => {
            const isSelected = source.id === selected.id;
            return (
              <button
                key={source.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(source.id)}
                className={cn(
                  "rounded px-4 py-2 text-sm transition-colors",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "bg-tint/10 text-foreground hover:bg-tint/20",
                )}
              >
                {source.label ?? source.provider}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Fonte: {selected.label ?? selected.provider}
        {selected.provider === "youtube"
          ? " · progresso salvo pela API oficial do player do YouTube"
          : selected.type === "iframe"
            ? " · o progresso desta fonte não é salvo"
            : ""}
      </p>
    </div>
  );
}
