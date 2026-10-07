"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordWatchStartAction, saveProgressAction } from "@/app/watch/actions";
import type { WatchTarget } from "@/components/playback/playback-target";

/**
 * Official YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference).
 * The player is created by the API itself (`new YT.Player`), so time and state
 * come from its documented methods/events — never from reading the
 * cross-origin iframe's DOM.
 */

interface YouTubePlayerInstance {
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayerInstance;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";
const STATE_ENDED = 0;
const STATE_PLAYING = 1;
const STATE_PAUSED = 2;
const SAVE_INTERVAL_MS = 10_000;
/** Same rule as WatchPlayer: resuming in the last seconds just replays the credits. */
const RESUME_END_MARGIN_SECONDS = 10;

let apiPromise: Promise<YouTubeNamespace> | null = null;

/** Loads the API script once per page; later players reuse it. */
function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) {
          resolve(window.YT);
        }
      };
      const script = document.createElement("script");
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error("Não foi possível carregar o player do YouTube."));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

interface YouTubePlayerProps {
  videoId: string;
  title: string;
  target: WatchTarget;
  resumeAt: number;
  nextHref?: string;
  onLoadError: () => void;
}

export function YouTubePlayer({
  videoId,
  title,
  target,
  resumeAt,
  nextHref,
  onLoadError,
}: YouTubePlayerProps) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let player: YouTubePlayerInstance | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let started = false;
    let disposed = false;

    function saveProgress() {
      if (!player) {
        return;
      }
      const duration = player.getDuration();
      const position = player.getCurrentTime();
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
        return;
      }
      void saveProgressAction({ ...target, positionInSeconds: position, durationInSeconds: duration });
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        saveProgress();
      }
    }

    loadYouTubeApi()
      .then((YT) => {
        if (disposed || !mountRef.current) {
          return;
        }
        // The API replaces this node with its own iframe.
        const node = document.createElement("div");
        mountRef.current.appendChild(node);

        player = new YT.Player(node, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
            ...(resumeAt > RESUME_END_MARGIN_SECONDS ? { start: Math.floor(resumeAt) } : {}),
          },
          events: {
            onStateChange: ({ data }) => {
              if (data === STATE_PLAYING) {
                if (!started) {
                  started = true;
                  void recordWatchStartAction(target);
                }
                if (!timer) {
                  timer = setInterval(saveProgress, SAVE_INTERVAL_MS);
                }
              } else if (data === STATE_PAUSED) {
                stopTimer();
                saveProgress();
              } else if (data === STATE_ENDED) {
                stopTimer();
                saveProgress();
                if (nextHref) {
                  router.push(nextHref);
                }
              }
            },
          },
        });
      })
      .catch(() => {
        if (!disposed) {
          onLoadError();
        }
      });

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopTimer();
      if (started) {
        saveProgress();
      }
      player?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one player per video; target/resumeAt/nextHref are fixed for it
  }, [videoId]);

  return (
    <div
      ref={mountRef}
      title={title}
      className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0"
    />
  );
}
