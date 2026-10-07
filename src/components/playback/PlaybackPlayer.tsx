"use client";

import { Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buttonStyles } from "@/components/ui/Button";
import type { WatchTarget } from "@/components/playback/playback-target";
import { YouTubePlayer } from "@/components/playback/YouTubePlayer";
import { getYouTubeVideoId } from "@/components/playback/youtube-url";
import type { PlaybackSource } from "@/services/playback/playback.types";

// Both checks below never change at runtime; on the server they are reported
// as unavailable (there is no window/document to ask).
const subscribeToNothing = () => () => {};
const getFullscreenSupport = () => document.fullscreenEnabled;
const getServerFullscreenSupport = () => false;

/**
 * Native HLS playback only works where the browser itself understands the
 * format (Safari/iOS). No current provider returns "hls", so hls.js is not
 * bundled — see README "PlaybackPlayer".
 */
const getHlsSupport = () =>
  document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
const getServerHlsSupport = () => false;

interface PlaybackPlayerProps {
  source: PlaybackSource;
  /** When set, providers with an official player API save progress/history against it. */
  target?: WatchTarget;
  resumeAt?: number;
  nextHref?: string;
}

/**
 * Renders a playback source inside a container that MatchFlix itself can put
 * in fullscreen, so the button works whatever the provider (or source type)
 * offers. The iframe keeps `allowFullScreen`, so a provider's own fullscreen
 * control still works too.
 */
export default function PlaybackPlayer({
  source,
  target,
  resumeAt = 0,
  nextHref,
}: PlaybackPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Falls back to the plain embed if the YouTube API script cannot load.
  const [youTubeApiFailed, setYouTubeApiFailed] = useState(false);
  const canFullscreen = useSyncExternalStore(
    subscribeToNothing,
    getFullscreenSupport,
    getServerFullscreenSupport,
  );
  const supportsHls = useSyncExternalStore(
    subscribeToNothing,
    getHlsSupport,
    getServerHlsSupport,
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
  const title = source.label ?? source.provider;
  const youTubeVideoId =
    source.provider === "youtube" && target && !youTubeApiFailed
      ? getYouTubeVideoId(source.url)
      : null;

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full overflow-hidden bg-black [&:fullscreen]:aspect-auto"
    >
      {youTubeVideoId && target ? (
        <YouTubePlayer
          key={source.id}
          videoId={youTubeVideoId}
          title={title}
          target={target}
          resumeAt={resumeAt}
          nextHref={nextHref}
          onLoadError={() => setYouTubeApiFailed(true)}
        />
      ) : source.type === "iframe" ? (
        <iframe
          key={source.id}
          src={source.url}
          title={title}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          // YouTube's embed requires an HTTP Referer to identify the site
          // (its policy recommends this value); other providers get none.
          referrerPolicy={
            source.provider === "youtube"
              ? "strict-origin-when-cross-origin"
              : "no-referrer"
          }
        />
      ) : source.type === "direct" ? (
        <video
          key={source.id}
          src={source.url}
          controls
          playsInline
          className="h-full w-full"
        />
      ) : source.type === "hls" ? (
        supportsHls ? (
          <video
            key={source.id}
            src={source.url}
            controls
            playsInline
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-4 text-center text-white">
            <p>Este navegador não sabe tocar este vídeo (HLS) nativamente.</p>
            <p className="text-muted-foreground text-sm">
              Tente no Safari/iOS, ou escolha outra fonte abaixo.
            </p>
          </div>
        )
      ) : source.type === "external" ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-white">
          <p>Esta fonte não pode ser exibida aqui dentro.</p>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonStyles("primary")}
          >
            Assistir no serviço
          </a>
        </div>
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
