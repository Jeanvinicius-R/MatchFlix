"use client";

import { useCallback, useEffect, useState } from "react";
import { AttributionNote } from "@/components/playback/AdaptivePlayer";
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
  /** Start playing on load (direct/hls/dash sources only). */
  autoPlay?: boolean;
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

/** Shown when there is nothing (left) to play; `children` say why. */
function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <Placeholder>
      <p className="text-base font-semibold tracking-wide">
        INDISPONÍVEL PARA REPRODUÇÃO
      </p>
      {children}
      <p className="text-sm text-white/70">
        Veja abaixo, em &quot;Onde assistir&quot;, os serviços que oferecem este título.
      </p>
    </Placeholder>
  );
}

/** What is said about progress/history for the source being played. */
function describeProgress(source: PlaybackSource): string {
  if (source.provider === "youtube") {
    return " · progresso salvo pela API oficial do player do YouTube";
  }
  if (source.type === "direct" || source.type === "hls" || source.type === "dash") {
    return " · progresso salvo neste player";
  }
  if (source.type === "iframe") {
    return " · o progresso desta fonte não é salvo";
  }
  return "";
}

/**
 * Asks the PlaybackResolver (through the API) which sources exist for a
 * movie/episode, plays the first one and lets the viewer switch between them.
 * A source the player gives up on is marked as failed and the next one is tried.
 */
export default function PlaybackSources({
  endpoint,
  target,
  resumeAt = 0,
  nextHref,
  autoPlay = false,
}: PlaybackSourcesProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
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
          setFailedIds([]);
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

  // Marks a source as failed and moves to the next one that has not failed yet
  // (in list order, wrapping around); none left means "unavailable".
  const handleFatalError = useCallback(
    (failedId: string) => {
      if (state.status !== "ready") {
        return;
      }
      const { sources } = state;
      const failed = failedIds.includes(failedId) ? failedIds : [...failedIds, failedId];
      const start = sources.findIndex((source) => source.id === failedId);
      const ordered = [...sources.slice(start + 1), ...sources.slice(0, start + 1)];
      const next = ordered.find((source) => !failed.includes(source.id));
      setFailedIds(failed);
      setSelectedId(next?.id ?? null);
    },
    [state, failedIds],
  );

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

  const { sources } = state;

  if (sources.length === 0) {
    return (
      <Unavailable>
        <p>Nenhuma fonte de reprodução autorizada está disponível para este título.</p>
      </Unavailable>
    );
  }

  const selected = sources.find(
    (source) => source.id === selectedId && !failedIds.includes(source.id),
  );

  return (
    <div className="flex flex-col gap-3">
      {selected ? (
        <PlaybackPlayer
          source={selected}
          target={target}
          resumeAt={resumeAt}
          nextHref={nextHref}
          autoPlay={autoPlay}
          // Without another source the overlay only offers the retry it already has.
          onFatalError={
            sources.length > 1 ? () => handleFatalError(selected.id) : undefined
          }
        />
      ) : (
        <Unavailable>
          <p role="alert">Nenhuma fonte conseguiu reproduzir este vídeo.</p>
          <button
            type="button"
            onClick={() => {
              setFailedIds([]);
              setSelectedId(sources[0].id);
            }}
            className="rounded bg-white/10 px-4 py-2 transition-colors hover:bg-white/20"
          >
            Tentar de novo
          </button>
        </Unavailable>
      )}

      {sources.length > 1 && (
        <div role="group" aria-label="Fontes de reprodução" className="flex flex-wrap gap-2">
          {sources.map((source) => {
            const isSelected = source.id === selected?.id;
            const hasFailed = failedIds.includes(source.id);
            return (
              <button
                key={source.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setFailedIds((ids) => ids.filter((id) => id !== source.id));
                  setSelectedId(source.id);
                }}
                className={cn(
                  "rounded px-4 py-2 text-sm transition-colors",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "bg-tint/10 text-foreground hover:bg-tint/20",
                  hasFailed && "line-through opacity-60",
                )}
              >
                {source.label ?? source.provider}
                {hasFailed && <span className="sr-only"> (falhou)</span>}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <>
          <p className="text-muted-foreground text-xs">
            Fonte: {selected.label ?? selected.provider}
            {describeProgress(selected)}
          </p>
          <AttributionNote attribution={selected.attribution} />
        </>
      )}
    </div>
  );
}
