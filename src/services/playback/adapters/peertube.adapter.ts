import type {
  PlaybackAttribution,
  PlaybackQuality,
  PlaybackSubtitle,
} from "../playback.types";
import {
  defaultFetch,
  fetchJson,
  isCleanHttpsUrl,
  isRecord,
  readRecord,
  type AdapterFailure,
  type PlaybackAdapter,
  type ResolvedAsset,
} from "./adapter.types";

/**
 * PeerTube adapter (public REST API, no login). A video is only used when the
 * instance is on the administrator's allowlist (PEERTUBE_ALLOWED_INSTANCES) and
 * the video itself passes a strict, fail-closed gate:
 *
 *   - privacy "Public" (1), state "Published" (1), not a live;
 *   - licence 1 (CC BY), 2 (CC BY-SA), 3 (CC BY-ND), 7 (public domain) or
 *     8 (free of known restrictions). 4-6 (non-commercial), 9 (all rights
 *     reserved) and a missing licence are refused.
 *
 * The licence is declared by the uploader, so this is a technical filter; the
 * administrative decision stays in PlaybackAssociation.rightsStatus.
 *
 * Media and subtitle URLs are taken as returned by the API but must be https AND
 * point to an allowlisted host: the licence and rights decision was made for the
 * allowlist, so a federated video served by another origin (or object storage on
 * its own host) fails closed unless that host is added to PEERTUBE_ALLOWED_INSTANCES.
 * API redirects are only followed within the same instance.
 */

export const PEERTUBE_ALLOWED_LICENCE_IDS: ReadonlySet<number> = new Set([1, 2, 3, 7, 8]);

/** Largest MP4 rendition offered; the HLS playlist adapts by itself. */
const MAX_MP4_HEIGHT = 1080;

const MAX_SUBTITLES = 20;

/** UUID, shortUUID or numeric id. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Hostname with a dot (no "localhost"), optional port. IP literals are refused below. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;
const IP_LITERAL_PATTERN = /^[\d.]+(:\d+)?$/;

/** "https://Tube.Example.org/path" or "tube.example.org" -> "tube.example.org", else null. */
function normalizeHost(raw: string): string | null {
  const value = raw.trim().toLowerCase();

  if (value === "") {
    return null;
  }

  let host = value;

  if (value.includes("://")) {
    try {
      const url = new URL(value);

      if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
        return null;
      }

      host = url.host;
    } catch {
      return null;
    }
  }

  return HOST_PATTERN.test(host) && !IP_LITERAL_PATTERN.test(host) ? host : null;
}

/**
 * Parses PEERTUBE_ALLOWED_INSTANCES: comma-separated hosts ("framatube.org,
 * video.blender.org"). Blanks and malformed entries are dropped. Empty set =
 * adapter off, no request is ever made.
 */
export function parsePeerTubeInstances(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normalizeHost)
      .filter((host): host is string => host !== null),
  );
}

/** "<host>/<uuid-or-shortUUID>" -> parts, or null when malformed. */
export function parsePeerTubeAssetId(assetId: string): { host: string; videoId: string } | null {
  const trimmed = assetId.trim();
  const slash = trimmed.indexOf("/");

  if (slash <= 0) {
    return null;
  }

  const host = normalizeHost(trimmed.slice(0, slash));
  const videoId = trimmed.slice(slash + 1);

  if (host === null || !VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return { host, videoId };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Why the video may not be shown, or null when it passes the gate. */
function findGateProblem(video: Record<string, unknown>): string | null {
  const privacy = readNumber(readRecord(video, "privacy").id);
  const state = readNumber(readRecord(video, "state").id);
  const licence = readNumber(readRecord(video, "licence").id);

  if (privacy !== 1) {
    return "O vídeo do PeerTube não é público.";
  }

  if (state !== 1) {
    return "O vídeo do PeerTube ainda não está publicado.";
  }

  // Strict: a missing flag is not "false".
  if (video.isLive !== false) {
    return "Transmissões ao vivo do PeerTube não são suportadas.";
  }

  if (licence === undefined || !PEERTUBE_ALLOWED_LICENCE_IDS.has(licence)) {
    return "A licença do vídeo do PeerTube não está na lista permitida.";
  }

  return null;
}

/** The URL's host[:port] is on the allowlist (media is only taken from trusted hosts). */
function isAllowedMediaUrl(url: string, allowed: ReadonlySet<string>): boolean {
  try {
    return allowed.has(new URL(url).host);
  } catch {
    return false;
  }
}

/** Progressive MP4 renditions with a picture, up to MAX_MP4_HEIGHT, best first. */
function collectMp4Qualities(
  video: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): PlaybackQuality[] {
  if (!Array.isArray(video.files)) {
    return [];
  }

  const qualities: PlaybackQuality[] = [];

  for (const file of video.files as unknown[]) {
    if (!isRecord(file) || file.hasVideo === false) {
      continue;
    }

    const url = file.fileUrl;

    // Older versions have no "height": the resolution id is the height in pixels.
    const height =
      readNumber(file.height) ?? readNumber(readRecord(file, "resolution").id);

    if (
      !isCleanHttpsUrl(url) ||
      !isAllowedMediaUrl(url, allowed) ||
      height === undefined ||
      height <= 0 ||
      height > MAX_MP4_HEIGHT
    ) {
      continue;
    }

    qualities.push({ label: `${height}p`, height, url });
  }

  return qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

function findHlsPlaylist(
  video: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  if (!Array.isArray(video.streamingPlaylists)) {
    return null;
  }

  for (const playlist of video.streamingPlaylists as unknown[]) {
    // type 1 = HLS
    if (!isRecord(playlist) || playlist.type !== 1) {
      continue;
    }

    const url = playlist.playlistUrl;

    if (isCleanHttpsUrl(url) && isAllowedMediaUrl(url, allowed)) {
      return url;
    }
  }

  return null;
}

/**
 * Only WebVTT, only https, only allowlisted hosts; "fileUrl" (>= 7.1) before the
 * deprecated "captionPath".
 */
function toSubtitleUrl(
  host: string,
  entry: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  for (const raw of [entry.fileUrl, entry.captionPath]) {
    if (typeof raw !== "string") {
      continue;
    }

    try {
      const url = new URL(raw, `https://${host}`);

      if (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        allowed.has(url.host) &&
        url.pathname.toLowerCase().endsWith(".vtt")
      ) {
        return url.toString();
      }
    } catch {
      // Not a URL: try the next field.
    }
  }

  return null;
}

async function fetchSubtitles(
  fetchImpl: typeof fetch,
  host: string,
  videoId: string,
  signal: AbortSignal,
  allowed: ReadonlySet<string>,
): Promise<PlaybackSubtitle[]> {
  const result = await fetchJson<unknown>(
    fetchImpl,
    `https://${host}/api/v1/videos/${videoId}/captions`,
    { signal, what: "as legendas do PeerTube", allowedHost: (target) => target === host },
  );

  // Subtitles are optional: a failure here never blocks the video.
  if (!result.ok) {
    return [];
  }

  const body = result.data;

  if (!isRecord(body) || !Array.isArray(body.data)) {
    return [];
  }

  const subtitles: PlaybackSubtitle[] = [];

  for (const entry of body.data as unknown[]) {
    if (!isRecord(entry)) {
      continue;
    }

    const languageInfo = readRecord(entry, "language");
    const language = readString(languageInfo.id);
    const url = toSubtitleUrl(host, entry, allowed);

    if (!language || !url) {
      continue;
    }

    subtitles.push({
      language,
      label: readString(languageInfo.label) ?? language,
      url,
    });

    if (subtitles.length >= MAX_SUBTITLES) {
      break;
    }
  }

  return subtitles;
}

export interface PeerTubeAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Hosts ("framatube.org") the administrator trusts. Empty/omitted = adapter off. */
  allowedInstances?: Iterable<string>;
}

export function createPeerTubeAdapter(options: PeerTubeAdapterOptions = {}): PlaybackAdapter {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const allowed: ReadonlySet<string> = new Set(
    Array.from(options.allowedInstances ?? [])
      .map(normalizeHost)
      .filter((host): host is string => host !== null),
  );

  return {
    id: "peertube",
    label: "PeerTube",
    assetIdHint:
      'Instância e vídeo: "<host>/<uuid>" (ex.: "framatube.org/f56ae219-f076-4faf-a7f2-ba8b29d1cc5f"). A instância precisa estar em PEERTUBE_ALLOWED_INSTANCES.',

    async resolve(assetId, { signal }): Promise<ResolvedAsset | AdapterFailure> {
      if (allowed.size === 0) {
        return { reason: "PeerTube desativado (PEERTUBE_ALLOWED_INSTANCES está vazio)." };
      }

      const parsed = parsePeerTubeAssetId(assetId);

      if (!parsed) {
        return { reason: 'Identificador do PeerTube inválido (use "<host>/<uuid>").' };
      }

      const { host, videoId } = parsed;

      if (!allowed.has(host)) {
        return { reason: `A instância "${host}" não está em PEERTUBE_ALLOWED_INSTANCES.` };
      }

      const result = await fetchJson<unknown>(
        fetchImpl,
        `https://${host}/api/v1/videos/${videoId}`,
        {
          signal,
          what: `o PeerTube (${host})`,
          allowedHost: (target) => target === host,
        },
      );

      if (!result.ok) {
        return { reason: result.reason };
      }

      const video = result.data;

      if (!isRecord(video)) {
        return { reason: "O PeerTube devolveu uma resposta inválida." };
      }

      const problem = findGateProblem(video);

      if (problem) {
        return { reason: problem };
      }

      const hlsUrl = findHlsPlaylist(video, allowed);
      const qualities = hlsUrl ? [] : collectMp4Qualities(video, allowed);

      if (!hlsUrl && qualities.length === 0) {
        return {
          reason:
            "O vídeo do PeerTube não tem HLS nem MP4 (até 1080p) em https numa instância permitida.",
        };
      }

      const licence = readRecord(video, "licence");
      const account = readRecord(video, "account");
      const channel = readRecord(video, "channel");
      const pageId = readString(video.shortUUID) ?? readString(video.uuid) ?? videoId;
      const attribution: PlaybackAttribution = {
        sourceUrl: `https://${host}/w/${encodeURIComponent(pageId)}`,
      };
      const licenseLabel = readString(licence.label);
      const author = readString(account.displayName) ?? readString(channel.displayName);

      if (licenseLabel) {
        attribution.license = licenseLabel;
      }

      if (author) {
        attribution.author = author;
      }

      const subtitles = await fetchSubtitles(fetchImpl, host, videoId, signal, allowed);
      const asset: ResolvedAsset = hlsUrl
        ? { type: "hls", url: hlsUrl, mimeType: "application/vnd.apple.mpegurl" }
        : { type: "direct", url: qualities[0].url, mimeType: "video/mp4", qualities };

      asset.label = "PeerTube";
      asset.attribution = attribution;

      if (subtitles.length > 0) {
        asset.subtitles = subtitles;
      }

      return asset;
    },
  };
}
