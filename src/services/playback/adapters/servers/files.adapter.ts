import {
  isCleanHttpsUrl,
  type AdapterFailure,
  type PlaybackAdapter,
  type ResolvedAsset,
} from "../adapter.types";
import type { FilesServerConfig } from "./config";
import {
  allowedOriginsFor,
  createServerHttp,
  fail,
  finalizeAsset,
  mediaFromExtension,
  toProxiedMedia,
  type MediaTarget,
} from "./shared";

/**
 * Static file server (nginx/S3/CDN) the operator owns or licensed. The asset id
 * is a RELATIVE path under `baseUrl`; it is validated segment by segment before
 * any URL is formed, so it can never choose the host, escape the base path or
 * smuggle a scheme.
 *
 * No auth, https and no "proxy": the browser fetches the public URL itself.
 * Anything else (auth, "proxy": true, "allowPrivateNetwork": true) goes through
 * the proxy, which only handles mp4/webm/hls.
 */

const SEGMENT = /^[A-Za-z0-9._~-]{1,100}$/;
const EXTENSIONS: ReadonlySet<string> = new Set(["mp4", "m3u8", "mpd", "webm"]);
const MAX_PATH_LENGTH = 300;
const MAX_SEGMENTS = 12;

const WHAT = "o servidor de arquivos";

/** The relative path and its extension, or null when the id is not a safe media path. */
export function parseFilesAssetId(
  raw: string,
): { path: string; extension: string } | null {
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH || raw.includes("..")) {
    return null;
  }

  const segments = raw.split("/");

  if (
    segments.length > MAX_SEGMENTS ||
    !segments.every((segment) => SEGMENT.test(segment) && !/^\.+$/.test(segment))
  ) {
    return null;
  }

  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf(".");
  const extension = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";

  return EXTENSIONS.has(extension) ? { path: raw, extension } : null;
}

export interface FilesAdapterOptions {
  config: FilesServerConfig;
  fetchImpl?: typeof fetch;
  /** Checks that the file really answers before resolve() succeeds (default true). */
  probe?: boolean;
}

export function createFilesAdapter(options: FilesAdapterOptions): PlaybackAdapter {
  const { config } = options;
  const http = createServerHttp({
    fetchImpl: options.fetchImpl,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  const allowedOrigins = allowedOriginsFor(config.baseUrl, []);
  const viaProxy =
    config.proxy || config.auth.type !== "none" || config.allowPrivateNetwork;

  return {
    id: config.id,
    label: config.label,
    assetIdHint:
      'Caminho relativo do arquivo (ex.: "filmes/bbb/master.m3u8"). Extensões: mp4, m3u8, mpd, webm.',
    licenseReference: config.licenseReference,
    allowPrivateNetwork: config.allowPrivateNetwork,

    async resolve(assetId, { signal }): Promise<ResolvedAsset | AdapterFailure> {
      const parsed = parseFilesAssetId(assetId.trim());
      const media = parsed ? mediaFromExtension(parsed.extension) : null;

      if (!parsed || media === null) {
        return fail(
          'Caminho de arquivo inválido (sem "..", sem esquema; extensões mp4, m3u8, mpd ou webm).',
        );
      }

      const url = `${config.baseUrl}/${parsed.path}`;
      let target: MediaTarget;

      if (viaProxy) {
        const proxy = toProxiedMedia({
          url,
          auth: config.auth,
          media,
          allowedOrigins,
          allowPrivateNetwork: config.allowPrivateNetwork,
        });

        if ("reason" in proxy) {
          return proxy;
        }

        target = { proxy };
      } else {
        if (!isCleanHttpsUrl(url)) {
          return fail("A URL do arquivo precisa ser https e sem credenciais embutidas.");
        }

        target = { url };
      }

      return finalizeAsset({
        http,
        signal,
        label: config.label,
        what: WHAT,
        media,
        target,
        allowedOrigins,
        probe: options.probe !== false,
      });
    },
  };
}
