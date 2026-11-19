import type { PlaybackAdapter } from "./adapter.types";
import { createArchiveAdapter } from "./archive.adapter";
import { createPeerTubeAdapter, parsePeerTubeInstances } from "./peertube.adapter";
import { buildServerAdapters } from "./servers/build";

/**
 * Every provider adapter the system knows. Adding a provider means writing an
 * adapter and listing it here: associations can only point at a registered id,
 * and index.ts builds one PlaybackProvider per adapter.
 *
 * PEERTUBE_ALLOWED_INSTANCES (comma-separated hosts) is the administrator's
 * allowlist; empty = the PeerTube adapter refuses everything.
 *
 * PLAYBACK_SERVERS (JSON array) describes the operator's own / licensed servers
 * (Xtream, M3U, static files, REST). Each valid item becomes one more adapter;
 * a broken variable is reported with a warning and never breaks the import.
 */
const builtIn: readonly PlaybackAdapter[] = [
  createArchiveAdapter(),
  createPeerTubeAdapter({
    allowedInstances: parsePeerTubeInstances(process.env.PEERTUBE_ALLOWED_INSTANCES),
  }),
];

function loadConfiguredAdapters(): PlaybackAdapter[] {
  try {
    return buildServerAdapters(process.env.PLAYBACK_SERVERS).filter(
      // The config already refuses reserved ids; this keeps the rule absolute.
      (adapter) => !builtIn.some((known) => known.id === adapter.id),
    );
  } catch {
    console.warn("PLAYBACK_SERVERS ignorado: erro inesperado ao carregar os servidores.");
    return [];
  }
}

export const adapters: readonly PlaybackAdapter[] = [...builtIn, ...loadConfiguredAdapters()];

export function findAdapter(id: string): PlaybackAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}
