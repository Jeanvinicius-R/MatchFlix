import type { PlaybackAdapter } from "../adapter.types";
import {
  describeServer,
  parsePlaybackServers,
  type ParseServersOptions,
  type PlaybackServerConfig,
} from "./config";
import { createEmbedAdapter } from "./embed.adapter";
import { createFilesAdapter } from "./files.adapter";
import { createM3uAdapter } from "./m3u.adapter";
import { createRestAdapter } from "./rest.adapter";
import { createXtreamAdapter } from "./xtream.adapter";

export interface BuildServerOptions {
  /** Tests inject a fake; production uses the safe fetch (no private addresses). */
  fetchImpl?: typeof fetch;
}

/** One adapter for one validated server config. */
export function buildServerAdapter(
  config: PlaybackServerConfig,
  options: BuildServerOptions = {},
): PlaybackAdapter {
  switch (config.kind) {
    case "xtream":
      return createXtreamAdapter({ config, fetchImpl: options.fetchImpl });
    case "m3u":
      return createM3uAdapter({ config, fetchImpl: options.fetchImpl });
    case "files":
      return createFilesAdapter({ config, fetchImpl: options.fetchImpl });
    case "rest":
      return createRestAdapter({ config, fetchImpl: options.fetchImpl });
    case "embed":
      return createEmbedAdapter({ config, fetchImpl: options.fetchImpl });
  }
}

/**
 * Adapters for every valid server of a PLAYBACK_SERVERS value. Never throws:
 * a server whose adapter cannot be built is skipped with a warning that only
 * names it (id, kind and origin; never a path, query or credential).
 */
export function buildServerAdapters(
  raw: string | undefined,
  options: BuildServerOptions & ParseServersOptions = {},
): PlaybackAdapter[] {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const adapters: PlaybackAdapter[] = [];

  for (const config of parsePlaybackServers(raw, { env: options.env, warn })) {
    try {
      adapters.push(buildServerAdapter(config, options));
    } catch {
      warn(`PLAYBACK_SERVERS: servidor ${describeServer(config)} ignorado (erro interno).`);
    }
  }

  return adapters;
}
