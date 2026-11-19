import { normalizeOrigin } from "./proxy-token";

/**
 * Rewrites an HLS playlist so EVERY URI it mentions goes back through the
 * proxy: segment/playlist lines and the `URI="..."` attribute of tags such as
 * EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF and
 * EXT-X-SESSION-KEY. Relative URIs are resolved against the playlist URL first.
 *
 * Fail closed: a URI that is not http(s), carries credentials in the userinfo
 * or points outside `allowedOrigins` makes the WHOLE manifest refused, so the
 * browser can never be sent to a host the proxy token does not cover.
 */

export type HlsRewriteResult =
  | { ok: true; manifest: string }
  | { ok: false; reason: string };

export interface HlsRewriteOptions {
  /** URL the manifest was fetched from (after redirects); resolves relative URIs. */
  baseUrl: string;
  /** Origins ("https://host[:port]") the manifest may reference. */
  allowedOrigins: readonly string[];
  /** Turns an allowed, absolute upstream URL into what the player must request. */
  rewriteUrl(absoluteUrl: string): string;
}

const MANIFEST_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

/** True when the content type (parameters ignored) is an HLS playlist. */
export function isHlsContentType(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }

  return MANIFEST_MEDIA_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}

/** True when the URL path ends in ".m3u8". */
export function hasHlsExtension(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith(".m3u8");
}

const ATTRIBUTE_PATTERN = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;

export function rewriteHlsManifest(
  manifest: string,
  options: HlsRewriteOptions,
): HlsRewriteResult {
  const allowed = new Set<string>();

  for (const origin of options.allowedOrigins) {
    const normalized = normalizeOrigin(origin);

    if (normalized !== null) {
      allowed.add(normalized);
    }
  }

  let base: URL;

  try {
    base = new URL(options.baseUrl);
  } catch {
    return { ok: false, reason: "URL do manifesto inválida." };
  }

  const state: { failure: string | null } = { failure: null };

  /** The rewritten URL for one URI of the manifest, or null (failure recorded). */
  function rewriteUri(raw: string): string | null {
    const value = raw.trim();

    if (value === "") {
      state.failure ??= "O manifesto tem uma URI vazia.";
      return null;
    }

    let target: URL;

    try {
      target = new URL(value, base);
    } catch {
      state.failure ??= "O manifesto tem uma URI inválida.";
      return null;
    }

    if (
      (target.protocol !== "https:" && target.protocol !== "http:") ||
      target.username !== "" ||
      target.password !== "" ||
      !allowed.has(target.origin)
    ) {
      state.failure ??= "O manifesto aponta para fora das origens permitidas.";
      return null;
    }

    target.hash = "";

    try {
      return options.rewriteUrl(target.href);
    } catch {
      state.failure ??= "Não foi possível reescrever uma URI do manifesto.";
      return null;
    }
  }

  const lines = manifest.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const firstLine = lines.find((line) => line.trim() !== "");

  if (firstLine === undefined || firstLine.trim() !== "#EXTM3U") {
    return { ok: false, reason: "O conteúdo não é um manifesto HLS." };
  }

  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      output.push("");
    } else if (trimmed.startsWith("#")) {
      const colon = trimmed.indexOf(":");

      if (colon === -1 || !trimmed.includes("URI=")) {
        output.push(trimmed);
        continue;
      }

      const head = trimmed.slice(0, colon + 1);
      const attributes = trimmed
        .slice(colon + 1)
        .replace(ATTRIBUTE_PATTERN, (match, name: string, value: string) => {
          if (name !== "URI") {
            return match;
          }

          if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
            state.failure ??= "O manifesto tem um atributo URI malformado.";
            return match;
          }

          const rewritten = rewriteUri(value.slice(1, -1));
          return rewritten === null ? match : `URI="${rewritten}"`;
        });

      output.push(head + attributes);
    } else {
      output.push(rewriteUri(trimmed) ?? "");
    }

    if (state.failure !== null) {
      return { ok: false, reason: state.failure };
    }
  }

  return { ok: true, manifest: `${output.join("\n").replace(/\n+$/, "")}\n` };
}
