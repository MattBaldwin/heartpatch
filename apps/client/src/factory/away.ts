// How long the kid was away from a patch, for the Factory's welcome-back
// card (#294, owner decision 2026-10-08: after 30 minutes or more away).
// "Away" is the time since the patch was last on screen, not since the last
// settle: a kid who keeps playing while a 30-minute batch finishes never
// left. The device remembers when it last saw each patch (per account), so
// an app that was closed and opened again still knows. Pure apart from the
// storage it's given, so it's unit-tested with a fake clock and storage.

export interface AwayTracker {
  /** The patch is on screen now (opened, or the app came back to the front). */
  arrived: (mapId: string) => void;
  /** The patch left the screen (another patch, home, the app went to the back). */
  left: (mapId: string) => void;
  /**
   * How long the kid was away, for a settle on this patch: the time since it
   * was last on screen for the first settle after arriving, 0 for every one
   * after while it stays (and 0 when it was never seen here, or there's no storage).
   */
  awayMs: (mapId: string) => number;
  /** A settle worked: while it's on screen, the kid is here now. */
  settled: (mapId: string, visible: boolean) => void;
}

export interface AwayDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Device clock, ms. */
  now: () => number;
  /** Where one patch's "last seen" lives (per account), or null when nobody's signed in. */
  key: (mapId: string) => string | null;
}

export function createAwayTracker(deps: AwayDeps): AwayTracker {
  /** Patches whose next settle measures time away (they just arrived). */
  const arriving = new Set<string>();

  const write = (mapId: string) => {
    const key = deps.key(mapId);
    if (!key || !deps.storage) return;
    try {
      deps.storage.setItem(key, String(deps.now()));
    } catch {
      // Private mode: no welcome-back card; the pop-up still says what landed.
    }
  };

  const read = (mapId: string): number | null => {
    const key = deps.key(mapId);
    if (!key || !deps.storage) return null;
    try {
      const raw = deps.storage.getItem(key);
      const at = raw === null ? NaN : Number(raw);
      return Number.isFinite(at) ? at : null;
    } catch {
      return null;
    }
  };

  return {
    arrived: (mapId) => {
      arriving.add(mapId);
    },
    left: (mapId) => {
      write(mapId);
      arriving.add(mapId);
    },
    awayMs: (mapId) => {
      if (!arriving.has(mapId)) return 0;
      const seen = read(mapId);
      return seen === null ? 0 : Math.max(0, deps.now() - seen);
    },
    settled: (mapId, visible) => {
      if (!visible) return;
      arriving.delete(mapId);
      write(mapId);
    },
  };
}
