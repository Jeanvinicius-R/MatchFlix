import type { PlaybackAdapter } from "./adapter.types";
import { createArchiveAdapter } from "./archive.adapter";
import { createPeerTubeAdapter, parsePeerTubeInstances } from "./peertube.adapter";

/**
 * Every provider adapter the system knows. Adding a provider means writing an
 * adapter and listing it here: associations can only point at a registered id,
 * and index.ts builds one PlaybackProvider per adapter.
 *
 * PEERTUBE_ALLOWED_INSTANCES (comma-separated hosts) is the administrator's
 * allowlist; empty = the PeerTube adapter refuses everything.
 */
export const adapters: readonly PlaybackAdapter[] = [
  createArchiveAdapter(),
  createPeerTubeAdapter({
    allowedInstances: parsePeerTubeInstances(process.env.PEERTUBE_ALLOWED_INSTANCES),
  }),
];

export function findAdapter(id: string): PlaybackAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}
