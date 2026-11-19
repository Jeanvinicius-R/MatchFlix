import type {
  PlaybackAttribution,
  PlaybackQuality,
  PlaybackSubtitle,
} from "@/services/playback/playback.types";

// Pure helpers behind AdaptivePlayer: no React, no DOM, so they can be tested
// with node:test.

/** Resuming within the last seconds would just replay the credits. */
export const RESUME_END_MARGIN_SECONDS = 10;
export const SAVE_INTERVAL_MS = 10_000;
export const NEXT_EPISODE_COUNTDOWN_SECONDS = 5;
/** hls.js uses -1 for "pick the level automatically" (adaptive bitrate). */
export const AUTO_QUALITY_VALUE = -1;
/** Subtitle menu value for "Desativadas". */
export const SUBTITLES_OFF_VALUE = -1;

/** One choice of a player menu section. */
export interface MenuOption {
  value: number;
  label: string;
}

/** The part of an hls.js `Level` the menu cares about. */
export interface LevelInfo {
  height?: number;
  width?: number;
  bitrate?: number;
  name?: string;
}

export interface IndexedLevel<T extends LevelInfo = LevelInfo> {
  /** Position in the original (manifest) list: what hls.js expects in `currentLevel`. */
  index: number;
  level: T;
}

/** The part of an hls.js audio track the menu cares about. */
export interface AudioTrackInfo {
  name?: string;
  lang?: string;
}

export interface AttributionView {
  /** "Autor: X · Licença: CC BY 3.0" — may be empty when only a link is known. */
  text: string;
  /** Page of the original work; only ever an http(s) URL. */
  href: string | null;
}

/**
 * Where to seek on `loadedmetadata`, or null to start from the beginning.
 * Same rule as WatchPlayer: no resume in the last seconds (or without a finite duration).
 */
export function pickResumePosition(resumeAt: number, duration: number): number | null {
  if (!Number.isFinite(resumeAt) || !Number.isFinite(duration)) {
    return null;
  }
  if (resumeAt > 0 && resumeAt < duration - RESUME_END_MARGIN_SECONDS) {
    return resumeAt;
  }
  return null;
}

/** Tallest first (ties: higher bitrate first, then manifest order). Keeps original indexes. */
export function sortLevelsByHeight<T extends LevelInfo>(
  levels: readonly T[],
): IndexedLevel<T>[] {
  const entries = levels.map((level, index) => ({ index, level }));
  entries.sort((a, b) => {
    const heightDiff = (b.level.height ?? 0) - (a.level.height ?? 0);
    const bitrateDiff = (b.level.bitrate ?? 0) - (a.level.bitrate ?? 0);
    return heightDiff || bitrateDiff || a.index - b.index;
  });
  return entries;
}

/** "1080p"; falls back to the bitrate ("800 kbps"), then the manifest name. */
export function labelForLevel(level: LevelInfo): string {
  const height = level.height ?? 0;
  if (height > 0) {
    return `${height}p`;
  }
  const bitrate = level.bitrate ?? 0;
  if (bitrate > 0) {
    return `${Math.round(bitrate / 1000)} kbps`;
  }
  return level.name?.trim() || "Qualidade";
}

/**
 * Quality menu of an HLS stream: "Auto" plus one entry per distinct height
 * (the highest-bitrate level of that height). Empty when there is no real
 * choice, so the menu hides the section.
 */
export function buildHlsQualityOptions(levels: readonly LevelInfo[]): MenuOption[] {
  const seen = new Set<string>();
  const options: MenuOption[] = [];
  for (const { index, level } of sortLevelsByHeight(levels)) {
    const label = labelForLevel(level);
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    options.push({ value: index, label });
  }
  if (options.length < 2) {
    return [];
  }
  return [{ value: AUTO_QUALITY_VALUE, label: "Auto" }, ...options];
}

function labelForQuality(quality: PlaybackQuality, index: number): string {
  const label = quality.label.trim();
  if (label) {
    return label;
  }
  return quality.height ? `${quality.height}p` : `Opção ${index + 1}`;
}

/**
 * Quality menu of progressive (MP4) renditions, tallest first. `value` is the
 * index in `qualities`. Empty when there is no real choice.
 */
export function buildMp4QualityOptions(
  qualities: readonly PlaybackQuality[] | undefined,
): MenuOption[] {
  if (!qualities || qualities.length < 2) {
    return [];
  }
  const entries = qualities.map((quality, index) => ({ quality, index }));
  entries.sort((a, b) => {
    const heightDiff = (b.quality.height ?? 0) - (a.quality.height ?? 0);
    return heightDiff || a.index - b.index;
  });
  return entries.map(({ quality, index }) => ({
    value: index,
    label: labelForQuality(quality, index),
  }));
}

/** URL of the selected progressive rendition, or the source URL when there are none. */
export function resolveProgressiveUrl(
  sourceUrl: string,
  qualities: readonly PlaybackQuality[] | undefined,
  qualityIndex: number,
): string {
  return qualities?.[qualityIndex]?.url ?? qualities?.[0]?.url ?? sourceUrl;
}

export function labelForAudioTrack(track: AudioTrackInfo, index: number): string {
  return track.name?.trim() || track.lang?.trim() || `Faixa ${index + 1}`;
}

/** Audio menu; empty (section hidden) unless there are at least two tracks. */
export function buildAudioOptions(tracks: readonly AudioTrackInfo[]): MenuOption[] {
  if (tracks.length < 2) {
    return [];
  }
  return tracks.map((track, index) => ({
    value: index,
    label: labelForAudioTrack(track, index),
  }));
}

/** Index of the subtitle to show at start (the first `isDefault`), or "off". */
export function pickDefaultSubtitleIndex(
  subtitles: readonly Pick<PlaybackSubtitle, "isDefault">[] | undefined,
): number {
  const index = subtitles?.findIndex((subtitle) => subtitle.isDefault === true) ?? -1;
  return index >= 0 ? index : SUBTITLES_OFF_VALUE;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    const { protocol } = new URL(value.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Credit line under the video; null when there is nothing to credit. */
export function formatAttribution(
  attribution: PlaybackAttribution | undefined,
): AttributionView | null {
  if (!attribution) {
    return null;
  }
  const parts: string[] = [];
  const author = attribution.author?.trim();
  const license = attribution.license?.trim();
  if (author) {
    parts.push(`Autor: ${author}`);
  }
  if (license) {
    parts.push(`Licença: ${license}`);
  }
  const href = isHttpUrl(attribution.sourceUrl) ? attribution.sourceUrl.trim() : null;
  if (parts.length === 0 && !href) {
    return null;
  }
  return { text: parts.join(" · "), href };
}

/** One tick of the "next episode" countdown; never below zero. */
export function tickCountdown(seconds: number): number {
  return Math.max(0, seconds - 1);
}

export function nextEpisodeLabel(seconds: number): string {
  return `Próximo episódio em ${seconds}s`;
}

/** Message for an HTMLMediaElement `error.code` (1 aborted, 2 network, 3 decode, 4 source). */
export function describeMediaError(code: number | undefined): string {
  switch (code) {
    case 2:
      return "Falha de rede ao carregar o vídeo.";
    case 3:
      return "O vídeo está corrompido ou usa um recurso que este navegador não suporta.";
    case 4:
      return "O vídeo não está acessível ou o formato não é suportado por este navegador.";
    default:
      return "Não foi possível reproduzir o vídeo.";
  }
}

// ---------------------------------------------------------------------------
// MPEG-DASH (dash.js). The shapes below are the few fields the menus read;
// dash.js 5 calls them "representations", 4.x "bitrate infos", so both
// spellings of the bandwidth field are accepted.
// ---------------------------------------------------------------------------

/** A video rendition reported by dash.js. */
export interface DashRepresentation {
  height?: number;
  width?: number;
  /** dash.js 5. */
  bandwidth?: number;
  /** dash.js 4. */
  bitrate?: number;
}

/** A text label of a dash.js media track. */
export interface DashLabel {
  text?: string;
  lang?: string;
}

/** An audio or text track (MediaInfo) reported by dash.js. */
export interface DashTrackInfo {
  lang?: string | null;
  labels?: readonly DashLabel[];
  roles?: readonly string[];
}

/** dash.js error codes that mean "could not download" (manifest, sidx, segments). */
const DASH_NETWORK_ERROR_CODES: ReadonlySet<number> = new Set([11, 25, 26, 27, 28, 29]);
/** dash.js error codes that mean "the manifest/format cannot be used". */
const DASH_UNSUPPORTED_ERROR_CODES: ReadonlySet<number> = new Set([10, 22, 30, 34]);

/** Quality menu of a DASH stream: same rules as HLS (Auto + one entry per height). */
export function buildDashQualityOptions(
  representations: readonly DashRepresentation[],
): MenuOption[] {
  return buildHlsQualityOptions(
    representations.map((representation) => ({
      height: representation.height,
      width: representation.width,
      bitrate: representation.bandwidth ?? representation.bitrate,
    })),
  );
}

function labelForDashTrack(track: DashTrackInfo): { name?: string; lang?: string } {
  const label = track.labels?.find((entry) => entry.text?.trim())?.text;
  return { name: label, lang: track.lang ?? undefined };
}

/** Audio menu of a DASH stream; empty unless there are at least two tracks. */
export function buildDashAudioOptions(tracks: readonly DashTrackInfo[]): MenuOption[] {
  return buildAudioOptions(tracks.map(labelForDashTrack));
}

/** Subtitle menu of text tracks embedded in a DASH stream ("Desativadas" first). */
export function buildDashSubtitleOptions(tracks: readonly DashTrackInfo[]): MenuOption[] {
  if (tracks.length === 0) {
    return [];
  }
  return [
    { value: SUBTITLES_OFF_VALUE, label: "Desativadas" },
    ...tracks.map((track, index) => ({
      value: index,
      label: labelForAudioTrack(labelForDashTrack(track), index),
    })),
  ];
}

/**
 * Maps a dash.js error code to the HTMLMediaElement code `describeMediaError`
 * understands (2 network, 4 source/format), so DASH failures reuse the same
 * overlay messages as HLS and progressive video.
 */
export function dashErrorToMediaCode(code: number | undefined): number | undefined {
  if (code === undefined) {
    return undefined;
  }
  if (DASH_NETWORK_ERROR_CODES.has(code)) {
    return 2;
  }
  if (DASH_UNSUPPORTED_ERROR_CODES.has(code)) {
    return 4;
  }
  return undefined;
}

/** Pulls the numeric code out of whatever a dash.js "error" event carries. */
export function readDashErrorCode(event: unknown): number | undefined {
  const error = (event as { error?: unknown } | null | undefined)?.error;
  if (typeof error === "number") {
    return error;
  }
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "number" ? code : undefined;
}
