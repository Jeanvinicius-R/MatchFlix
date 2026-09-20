"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordWatchStartAction, saveProgressAction } from "@/app/watch/actions";

interface WatchPlayerProps {
  src: string;
  mimeType: string | null;
  poster?: string;
  target: { kind: "movie" | "episode"; contentId: string };
  /** Seconds to resume from; 0 starts from the beginning. */
  resumeAt: number;
  /** Start playing on load (used when arriving via "next episode"). */
  autoPlay?: boolean;
  /** When set, the player moves here as soon as the video ends. */
  nextHref?: string;
}

const SAVE_INTERVAL_MS = 10_000;
/** Resuming within the last seconds would just replay the credits. */
const RESUME_END_MARGIN_SECONDS = 10;

export function WatchPlayer({
  src,
  mimeType,
  poster,
  target,
  resumeAt,
  autoPlay = false,
  nextHref,
}: WatchPlayerProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAtRef = useRef(0);
  const startedRef = useRef(false);

  function saveProgress() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    lastSavedAtRef.current = Date.now();
    void saveProgressAction({
      ...target,
      positionInSeconds: video.currentTime,
      durationInSeconds: video.duration,
    });
  }

  // Tab hidden / phone locked: onPause may never fire, so save here too.
  useEffect(() => {
    function handleVisibilityChange() {
      const video = videoRef.current;
      if (document.visibilityState === "hidden" && video && !video.paused) {
        saveProgress();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveProgress only reads refs and the stable `target`
  }, []);

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      autoPlay={autoPlay}
      preload="metadata"
      poster={poster}
      className="aspect-video w-full rounded-lg bg-black"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (resumeAt > 0 && resumeAt < video.duration - RESUME_END_MARGIN_SECONDS) {
          video.currentTime = resumeAt;
        }
      }}
      onPlay={() => {
        if (!startedRef.current) {
          startedRef.current = true;
          void recordWatchStartAction(target);
        }
      }}
      onTimeUpdate={() => {
        if (Date.now() - lastSavedAtRef.current >= SAVE_INTERVAL_MS) {
          saveProgress();
        }
      }}
      onPause={saveProgress}
      onEnded={() => {
        saveProgress();
        if (nextHref) {
          router.push(nextHref);
        }
      }}
    >
      <source src={src} type={mimeType ?? undefined} />
      Seu navegador não suporta reprodução de vídeo.
    </video>
  );
}
