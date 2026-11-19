import type {
  DashRepresentation,
  DashTrackInfo,
} from "@/components/playback/player-utils";

// Thin, deliberately loose view of the dash.js MediaPlayer. dash.js 4 and 5
// differ in method names (getBitrateInfoListFor / setQualityFor vs
// getRepresentationsByType / setRepresentationForTypeById), so everything
// version-specific is optional and feature-detected by the caller.

export interface DashRepresentationWithId extends DashRepresentation {
  id?: string | number;
  /** dash.js 4 quality index. */
  qualityIndex?: number;
}

export interface DashPlayerLike {
  initialize(
    view: HTMLVideoElement,
    source: string,
    autoPlay?: boolean,
    startTime?: number,
  ): void;
  on(type: string, listener: (event: unknown) => void): void;
  off?(type: string, listener: (event: unknown) => void): void;
  updateSettings(settings: Record<string, unknown>): void;
  seek?(seconds: number): void;
  duration?(): number;
  // Quality.
  getRepresentationsByType?(type: string): DashRepresentationWithId[];
  getBitrateInfoListFor?(type: string): DashRepresentationWithId[];
  setRepresentationForTypeById?(type: string, id: string | number, force?: boolean): void;
  setQualityFor?(type: string, index: number, force?: boolean): void;
  // Audio / text tracks.
  getTracksFor?(type: string): DashTrackInfo[];
  getCurrentTrackFor?(type: string): DashTrackInfo | null;
  setCurrentTrack?(track: DashTrackInfo): void;
  enableText?(enable: boolean): void;
  setTextTrack?(index: number): void;
  // Teardown (4.x only has reset; 5 adds destroy).
  reset?(): void;
  destroy?(): void;
}

interface DashModule {
  MediaPlayer?: () => { create: () => DashPlayerLike };
  default?: { MediaPlayer?: () => { create: () => DashPlayerLike } };
}

/**
 * Loads dash.js on demand (it is large and only DASH sources need it) and
 * creates a player. Rejects when the module has no MediaPlayer factory.
 */
export async function createDashPlayer(): Promise<DashPlayerLike> {
  const loaded = (await import("dashjs")) as unknown as DashModule;
  const factory = loaded.MediaPlayer ?? loaded.default?.MediaPlayer;
  if (typeof factory !== "function") {
    throw new Error("dash.js sem MediaPlayer");
  }
  return factory().create();
}

/** Stops dash.js and frees its resources; never throws. */
export function disposeDashPlayer(player: DashPlayerLike): void {
  try {
    if (typeof player.destroy === "function") {
      player.destroy();
    } else {
      player.reset?.();
    }
  } catch {
    // Already torn down (the <video> may be gone): nothing left to free.
  }
}

/** Video renditions, whichever API generation the loaded dash.js has. */
export function listDashRepresentations(
  player: DashPlayerLike,
): DashRepresentationWithId[] {
  const list =
    player.getRepresentationsByType?.("video") ?? player.getBitrateInfoListFor?.("video");
  return list ? [...list] : [];
}

/** Locks one rendition (and stops adaptive switching), or returns to automatic. */
export function selectDashRepresentation(
  player: DashPlayerLike,
  representations: readonly DashRepresentationWithId[],
  index: number | null,
): void {
  player.updateSettings({
    streaming: { abr: { autoSwitchBitrate: { video: index === null } } },
  });
  if (index === null) {
    return;
  }
  const representation = representations[index];
  if (!representation) {
    return;
  }
  if (player.setRepresentationForTypeById && representation.id !== undefined) {
    player.setRepresentationForTypeById("video", representation.id, true);
  } else {
    player.setQualityFor?.("video", representation.qualityIndex ?? index, true);
  }
}
