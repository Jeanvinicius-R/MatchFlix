"use client";

import type Hls from "hls.js";
import { Check, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { recordWatchStartAction, saveProgressAction } from "@/app/watch/actions";
import type { WatchTarget } from "@/components/playback/playback-target";
import {
  AUTO_QUALITY_VALUE,
  NEXT_EPISODE_COUNTDOWN_SECONDS,
  SAVE_INTERVAL_MS,
  SUBTITLES_OFF_VALUE,
  buildAudioOptions,
  buildHlsQualityOptions,
  buildMp4QualityOptions,
  describeMediaError,
  formatAttribution,
  nextEpisodeLabel,
  pickDefaultSubtitleIndex,
  pickResumePosition,
  resolveProgressiveUrl,
  tickCountdown,
  type MenuOption,
} from "@/components/playback/player-utils";
import { buttonStyles } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type {
  PlaybackAttribution,
  PlaybackSource,
} from "@/services/playback/playback.types";

// Native HLS (Safari/iOS) is a fact of the browser; on the server it is
// reported as unavailable (there is no document to ask).
const subscribeToNothing = () => () => {};
const getNativeHlsSupport = () =>
  document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
const getServerNativeHlsSupport = () => false;

/** Times hls.js may restart loading / the media pipeline before giving up. */
const MAX_RECOVERY_ATTEMPTS = 3;
const CURRENT_CHOICE_SELECTOR = "button[aria-pressed='true']";

const OVERLAY_BUTTON_CLASS =
  "rounded-md bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none";

interface AdaptivePlayerProps {
  /** Only "direct" (progressive MP4/WebM) and "hls" sources are played here. */
  source: PlaybackSource;
  /** When set, progress and history are saved against it. */
  target?: WatchTarget;
  /** Seconds to resume from; 0 starts from the beginning. */
  resumeAt?: number;
  /** When set, the player offers (and then moves to) the next episode on end. */
  nextHref?: string;
  /** Start playing on load (used when arriving via "next episode"). */
  autoPlay?: boolean;
  /** Playback cannot continue and the viewer asked for another source. */
  onFatalError?: () => void;
}

/** Where to seek (and whether to play) once the next load has its metadata. */
interface PendingSeek {
  time: number | null;
  play: boolean;
}

interface MenuSectionProps {
  title: string;
  options: MenuOption[];
  value: number;
  onSelect: (value: number) => void;
}

function MenuSection({ title, options, value, onSelect }: MenuSectionProps) {
  const headingId = useId();

  return (
    <div role="group" aria-labelledby={headingId} className="mb-3 last:mb-0">
      <p
        id={headingId}
        className="mb-1 px-2 text-xs font-semibold tracking-wide text-white/60 uppercase"
      >
        {title}
      </p>
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(option.value)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
              isSelected && "bg-white/15 font-semibold",
            )}
          >
            <span>{option.label}</span>
            {isSelected && <Check size={14} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/** Discreet credit line (author, licence, link to the work) shown under the video. */
export function AttributionNote({ attribution }: { attribution?: PlaybackAttribution }) {
  const view = formatAttribution(attribution);
  if (!view) {
    return null;
  }

  return (
    <p className="text-muted-foreground text-xs">
      {view.text}
      {view.href && (
        <>
          {view.text && " · "}
          <a
            href={view.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Obra original
          </a>
        </>
      )}
    </p>
  );
}

/**
 * Plays "direct" (MP4/WebM) and "hls" sources in a native <video> and adds what
 * the native controls lack: a settings menu (quality, audio, subtitles), a
 * loading indicator, an error overlay with retry, resume, progress/history and
 * a "next episode" countdown. HLS uses the browser's own support when it has
 * it (Safari/iOS) and hls.js otherwise, loaded only when needed.
 */
export function AdaptivePlayer({
  source,
  target,
  resumeAt = 0,
  nextHref,
  autoPlay = false,
  onFatalError,
}: AdaptivePlayerProps) {
  const router = useRouter();
  const panelId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const lastSavedAtRef = useRef(0);
  const startedRef = useRef(false);
  const pendingSeekRef = useRef<PendingSeek | null>(null);

  const nativeHls = useSyncExternalStore(
    subscribeToNothing,
    getNativeHlsSupport,
    getServerNativeHlsSupport,
  );
  const viaHlsJs = source.type === "hls" && !nativeHls;

  // Bumped by "Tentar de novo": remounts the <video> and restarts hls.js.
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hlsQualityOptions, setHlsQualityOptions] = useState<MenuOption[]>([]);
  const [hlsQuality, setHlsQuality] = useState(AUTO_QUALITY_VALUE);
  const [mp4Quality, setMp4Quality] = useState(0);
  const [audioOptions, setAudioOptions] = useState<MenuOption[]>([]);
  const [audioValue, setAudioValue] = useState(0);
  const [subtitleValue, setSubtitleValue] = useState(() =>
    pickDefaultSubtitleIndex(source.subtitles),
  );
  const [countdown, setCountdown] = useState<number | null>(null);

  const subtitles = useMemo(() => source.subtitles ?? [], [source.subtitles]);
  const mp4QualityOptions = useMemo(
    () => buildMp4QualityOptions(source.qualities),
    [source.qualities],
  );
  const subtitleOptions = useMemo<MenuOption[]>(
    () => [
      { value: SUBTITLES_OFF_VALUE, label: "Desativadas" },
      ...subtitles.map((subtitle, index) => ({ value: index, label: subtitle.label })),
    ],
    [subtitles],
  );

  const qualityOptions = viaHlsJs
    ? hlsQualityOptions
    : source.type === "direct"
      ? mp4QualityOptions
      : [];
  const qualityValue = viaHlsJs ? hlsQuality : mp4Quality;
  const hasSettings =
    qualityOptions.length > 0 || audioOptions.length > 0 || subtitles.length > 0;

  // "hls" without hls.js is attached by the effect below, so it has no src.
  const videoSrc = viaHlsJs
    ? undefined
    : source.type === "direct"
      ? resolveProgressiveUrl(source.url, source.qualities, mp4Quality)
      : source.url;

  function saveProgress() {
    const video = videoRef.current;
    if (!target || !video || !Number.isFinite(video.duration) || video.duration <= 0) {
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

  // hls.js: loaded on demand, one instance per (source, attempt), always destroyed.
  useEffect(() => {
    const video = videoRef.current;
    if (!viaHlsJs || !video) {
      return;
    }

    let disposed = false;
    let hls: Hls | null = null;

    import("hls.js")
      .then(({ default: HlsClass }) => {
        if (disposed) {
          return;
        }
        if (!HlsClass.isSupported()) {
          setErrorMessage("Este navegador não consegue reproduzir este formato (HLS).");
          setLoading(false);
          return;
        }

        const instance = new HlsClass();
        hls = instance;
        hlsRef.current = instance;
        let networkRetries = 0;
        let mediaRecoveries = 0;

        instance.on(HlsClass.Events.MANIFEST_PARSED, (_event, data) => {
          setHlsQualityOptions(buildHlsQualityOptions(data.levels));
          setHlsQuality(AUTO_QUALITY_VALUE);
        });
        instance.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          setAudioOptions(buildAudioOptions(data.audioTracks));
          setAudioValue(instance.audioTrack);
        });
        instance.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, () => {
          setAudioValue(instance.audioTrack);
        });
        instance.on(HlsClass.Events.FRAG_BUFFERED, () => {
          networkRetries = 0;
        });
        instance.on(HlsClass.Events.ERROR, (_event, data) => {
          if (!data.fatal) {
            return;
          }
          // Restarting the load only works once the manifest is parsed; manifest
          // failures are already retried by hls.js itself.
          const isManifestError = data.details.startsWith("manifest");
          const isNetwork = data.type === HlsClass.ErrorTypes.NETWORK_ERROR;
          const isMedia = data.type === HlsClass.ErrorTypes.MEDIA_ERROR;
          if (isNetwork && !isManifestError && networkRetries < MAX_RECOVERY_ATTEMPTS) {
            networkRetries += 1;
            instance.startLoad();
            return;
          }
          if (isMedia && mediaRecoveries < MAX_RECOVERY_ATTEMPTS) {
            mediaRecoveries += 1;
            instance.recoverMediaError();
            return;
          }
          instance.stopLoad();
          setLoading(false);
          setErrorMessage(describeMediaError(isNetwork ? 2 : isMedia ? 3 : undefined));
        });

        instance.attachMedia(video);
        instance.loadSource(source.url);
      })
      .catch(() => {
        if (!disposed) {
          setErrorMessage("Não foi possível carregar o player de vídeo.");
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      hlsRef.current = null;
      hls?.destroy();
    };
  }, [viaHlsJs, source.url, attempt]);

  // Subtitle choice -> <track> modes (the nodes are re-created on each attempt).
  useEffect(() => {
    const tracks = videoRef.current?.querySelectorAll("track");
    tracks?.forEach((element, index) => {
      element.track.mode = index === subtitleValue ? "showing" : "disabled";
    });
  }, [subtitleValue, subtitles, attempt]);

  // Settings menu: focus the current choice, close on outside click.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const panel = panelRef.current;
    const current = panel?.querySelector<HTMLButtonElement>(CURRENT_CHOICE_SELECTOR);
    (current ?? panel)?.focus();

    function handlePointerDown(event: PointerEvent) {
      const node = event.target as Node;
      const insidePanel = panelRef.current?.contains(node);
      const onButton = settingsButtonRef.current?.contains(node);
      if (insidePanel || onButton) {
        return;
      }
      setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  // "Próximo episódio em Ns": one tick per second until it reaches zero.
  const isCountingDown = countdown !== null && countdown > 0;
  useEffect(() => {
    if (!isCountingDown) {
      return;
    }
    const timer = setInterval(() => {
      setCountdown((seconds) => (seconds === null ? null : tickCountdown(seconds)));
    }, 1000);
    return () => clearInterval(timer);
  }, [isCountingDown]);

  useEffect(() => {
    if (countdown === 0 && nextHref) {
      router.push(nextHref);
    }
  }, [countdown, nextHref, router]);

  function handleSelectQuality(value: number) {
    if (viaHlsJs) {
      const hls = hlsRef.current;
      if (hls) {
        hls.currentLevel = value;
      }
      setHlsQuality(value);
      return;
    }

    const video = videoRef.current;
    if (!video || value === mp4Quality) {
      return;
    }
    // New URL, same moment: keep the position and whether it was playing.
    pendingSeekRef.current = {
      time: video.currentTime > 0 ? video.currentTime : null,
      play: !video.paused,
    };
    setLoading(true);
    setMp4Quality(value);
  }

  function handleSelectAudio(value: number) {
    const hls = hlsRef.current;
    if (hls) {
      hls.audioTrack = value;
    }
    setAudioValue(value);
  }

  function handleRetry() {
    const video = videoRef.current;
    pendingSeekRef.current = {
      time: video && video.currentTime > 0 ? video.currentTime : null,
      play: true,
    };
    setErrorMessage(null);
    setLoading(true);
    setHlsQualityOptions([]);
    setAudioOptions([]);
    setAttempt((value) => value + 1);
  }

  function closeMenu() {
    setMenuOpen(false);
    settingsButtonRef.current?.focus();
  }

  return (
    <div className="relative h-full w-full">
      <video
        key={attempt}
        ref={videoRef}
        src={videoSrc}
        controls
        playsInline
        autoPlay={autoPlay}
        preload="metadata"
        // Cross-origin <track> files are only fetched when the video asks for CORS.
        crossOrigin={subtitles.length > 0 ? "anonymous" : undefined}
        className="h-full w-full bg-black"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setLoading(false);
          const pending = pendingSeekRef.current;
          pendingSeekRef.current = null;
          const position =
            pending && pending.time !== null
              ? pending.time
              : pickResumePosition(resumeAt, video.duration);
          if (position !== null) {
            video.currentTime = position;
          }
          if (pending?.play) {
            video.play().catch(() => {
              // Autoplay blocked: the viewer starts it with the controls.
            });
          } else if (pending) {
            // A new src re-arms the autoplay attribute; keep a paused viewer paused.
            video.pause();
          }
        }}
        onLoadStart={() => setLoading(true)}
        onWaiting={() => setLoading(true)}
        onStalled={(event) => setLoading(!event.currentTarget.paused)}
        onCanPlay={() => setLoading(false)}
        onPlaying={() => setLoading(false)}
        onSeeked={() => setLoading(false)}
        onError={(event) => {
          // hls.js reports (and recovers from) media errors on its own.
          if (viaHlsJs) {
            return;
          }
          setLoading(false);
          setErrorMessage(describeMediaError(event.currentTarget.error?.code));
        }}
        onPlay={() => {
          setCountdown(null);
          if (target && !startedRef.current) {
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
            setCountdown(NEXT_EPISODE_COUNTDOWN_SECONDS);
          }
        }}
      >
        {subtitles.map((subtitle) => (
          <track
            key={`${subtitle.language}-${subtitle.url}`}
            kind="subtitles"
            src={subtitle.url}
            srcLang={subtitle.language}
            label={subtitle.label}
          />
        ))}
        Seu navegador não suporta reprodução de vídeo.
      </video>

      {loading && !errorMessage && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white"
          />
          <span role="status" className="sr-only">Carregando vídeo</span>
        </div>
      )}

      {hasSettings && !errorMessage && (
        <>
          <button
            ref={settingsButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Configurações do player"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            title="Configurações"
            className="absolute top-3 right-3 z-10 inline-flex items-center rounded bg-black/70 p-2 text-white opacity-80 transition-colors hover:bg-black/90 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <Settings size={18} aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="Configurações do player"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  closeMenu();
                }
              }}
              className="absolute top-14 right-3 z-20 max-h-[calc(100%-4.5rem)] w-64 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg bg-black/90 p-3 text-sm text-white focus:outline-none"
            >
              {qualityOptions.length > 0 && (
                <MenuSection
                  title="Qualidade"
                  options={qualityOptions}
                  value={qualityValue}
                  onSelect={handleSelectQuality}
                />
              )}
              {audioOptions.length > 0 && (
                <MenuSection
                  title="Áudio"
                  options={audioOptions}
                  value={audioValue}
                  onSelect={handleSelectAudio}
                />
              )}
              {subtitles.length > 0 && (
                <MenuSection
                  title="Legendas"
                  options={subtitleOptions}
                  value={subtitleValue}
                  onSelect={setSubtitleValue}
                />
              )}
            </div>
          )}
        </>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 px-4 text-center text-white"
        >
          <p>{errorMessage}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={handleRetry} className={OVERLAY_BUTTON_CLASS}>
              Tentar de novo
            </button>
            {onFatalError && (
              <button
                type="button"
                onClick={onFatalError}
                className={OVERLAY_BUTTON_CLASS}
              >
                Tentar outra fonte
              </button>
            )}
          </div>
        </div>
      )}

      {countdown !== null && nextHref && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80 px-4 text-center text-white">
          <p className="text-lg font-semibold">{nextEpisodeLabel(countdown)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => router.push(nextHref)}
              className={buttonStyles("primary")}
            >
              Assistir agora
            </button>
            <button
              type="button"
              onClick={() => setCountdown(null)}
              className={OVERLAY_BUTTON_CLASS}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
