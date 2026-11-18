import type { PlaybackSource, PlaybackType } from "./playback.types";

/**
 * Central check on every URL a provider hands to the player. A provider is free
 * to be wrong (or hostile), but its output goes straight into <iframe src>,
 * <video src>, <track src> and <a href>, so nothing leaves the resolver unchecked.
 *
 * Rules: only http/https, no credentials embedded in the URL, a known source
 * type, and https for everything the player fetches itself (direct/hls/dash,
 * qualities, subtitles). Iframes/external links may still be plain http because
 * the browser treats them as separate documents.
 */

const ALLOWED_TYPES: ReadonlySet<PlaybackType> = new Set<PlaybackType>([
  "iframe",
  "hls",
  "dash",
  "direct",
  "external",
]);

/** Types the player loads by itself: mixed content (http) would be blocked or unsafe. */
const HTTPS_ONLY_TYPES: ReadonlySet<PlaybackType> = new Set<PlaybackType>([
  "direct",
  "hls",
  "dash",
]);

const MAX_URL_LENGTH = 4096;

function parseWebUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (url.username !== "" || url.password !== "" || url.hostname === "") {
    return null;
  }

  return url;
}

function isHttpsUrl(value: unknown): boolean {
  return parseWebUrl(value)?.protocol === "https:";
}

/** Why the source's main URL/type is unacceptable, or null when it passes. */
export function describeSourceProblem(source: PlaybackSource): string | null {
  if (!ALLOWED_TYPES.has(source.type)) {
    return `tipo de fonte não permitido (${String(source.type)})`;
  }

  const url = parseWebUrl(source.url);

  if (!url) {
    return "URL inválida (só http/https, sem credenciais na URL)";
  }

  if (HTTPS_ONLY_TYPES.has(source.type) && url.protocol !== "https:") {
    return `fontes "${source.type}" exigem https`;
  }

  return null;
}

/**
 * Returns the source when it is safe to show, or null when it must be dropped.
 * Optional extras (qualities, subtitles, attribution link) with a bad URL are
 * stripped from a copy instead of discarding the whole source.
 */
export function sanitizeSource(source: PlaybackSource): PlaybackSource | null {
  if (describeSourceProblem(source) !== null) {
    return null;
  }

  const safe: PlaybackSource = { ...source };

  if (source.qualities) {
    const qualities = source.qualities.filter((quality) => isHttpsUrl(quality.url));

    if (qualities.length > 0) {
      safe.qualities = qualities;
    } else {
      delete safe.qualities;
    }
  }

  if (source.subtitles) {
    const subtitles = source.subtitles.filter((track) => isHttpsUrl(track.url));

    if (subtitles.length > 0) {
      safe.subtitles = subtitles;
    } else {
      delete safe.subtitles;
    }
  }

  if (source.attribution?.sourceUrl !== undefined) {
    if (!parseWebUrl(source.attribution.sourceUrl)) {
      const attribution = { ...source.attribution };
      delete attribution.sourceUrl;
      safe.attribution = attribution;
    }
  }

  return safe;
}
