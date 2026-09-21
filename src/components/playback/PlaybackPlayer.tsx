"use client";

import { Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PlaybackSource } from "@/services/playback/playback.types";

// The Fullscreen API never changes at runtime; on the server it is reported as unavailable.
const subscribeToNothing = () => () => {};
const getFullscreenSupport = () => document.fullscreenEnabled;
const getServerFullscreenSupport = () => false;

interface PlaybackPlayerProps {
  source: PlaybackSource;
}

/**
 * Renders a playback source inside a container that MatchFlix itself can put
 * in fullscreen, so the button works whatever the provider (or source type)
 * offers. The iframe keeps `allowFullScreen`, so a provider's own fullscreen
 * control still works too.
 */
export default function PlaybackPlayer({ source }: PlaybackPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canFullscreen = useSyncExternalStore(
    subscribeToNothing,
    getFullscreenSupport,
    getServerFullscreenSupport,
  );

  useEffect(() => {
    function handleChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen();
      }
    } catch (error) {
      // Denied or unsupported: the player itself keeps working.
      console.warn("Não foi possível alternar a tela cheia.", error);
    }
  }, []);

  const label = isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia";

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full overflow-hidden bg-black [&:fullscreen]:aspect-auto"
    >
      {source.type === "iframe" ? (
        <iframe
          key={source.id}
          src={source.url}
          title={source.label ?? source.provider}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white">
          <p>Tipo de fonte ainda não suportado.</p>
        </div>
      )}

      {canFullscreen && (
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={label}
          title={label}
          className="absolute right-3 bottom-12 z-10 inline-flex items-center gap-2 rounded bg-black/70 px-3 py-2 text-sm text-white transition-colors hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          {isFullscreen ? (
            <Minimize size={16} aria-hidden="true" />
          ) : (
            <Maximize size={16} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{label}</span>
        </button>
      )}
    </div>
  );
}
