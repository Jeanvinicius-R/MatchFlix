import { parsePlaybackServers } from "./adapters/servers/config";

/**
 * Origins the player may put in an <iframe>. They feed the CSP `frame-src`
 * (src/proxy.ts), so a bug or a hostile value in a source URL still cannot make
 * the browser load a page from an origin the operator did not configure.
 *
 *   - YouTube and the Internet Archive embeds the built-in providers use;
 *   - PLAYBACK_AUTHORIZED_BASE_URL's origin (the single authorized source);
 *   - every ENABLED "embed" server of PLAYBACK_SERVERS.
 *
 * Pure: reads only the env it is given and never throws.
 */

type Env = Record<string, string | undefined>;

const BUILT_IN_FRAME_ORIGINS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://archive.org",
] as const;

function originOfHttpUrl(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Distinct "scheme://host[:port]" origins allowed to be framed, in a stable order. */
export function listFrameOrigins(env: Env = process.env): string[] {
  const origins = new Set<string>(BUILT_IN_FRAME_ORIGINS);
  const authorized = originOfHttpUrl(env.PLAYBACK_AUTHORIZED_BASE_URL);

  if (authorized !== null) {
    origins.add(authorized);
  }

  try {
    for (const server of parsePlaybackServers(env.PLAYBACK_SERVERS, {
      env,
      warn: () => undefined,
    })) {
      if (server.kind === "embed" && server.enabled) {
        origins.add(server.baseUrl);
      }
    }
  } catch {
    // A broken PLAYBACK_SERVERS only means no embed origin is allowed.
  }

  return [...origins];
}

/** The Content-Security-Policy of a page: nobody frames MatchFlix, it frames only these. */
export function buildFramePolicy(env: Env = process.env): string {
  return `frame-ancestors 'none'; frame-src 'self' ${listFrameOrigins(env).join(" ")}`;
}
