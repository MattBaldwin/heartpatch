import { formatAppVersion, type BuildInfo, type HealthResponse } from '@heartpatch/shared';
import { updateHold, type UpdateHold } from './update-hold.js';

// Which version the app runs, and whether a newer one is ready (#198). The
// profile menu reads this: a waiting service worker (update-flow.ts offers
// it) or a server built from a newer commit both mean "update ready".

/** What `/health` says about the server's build. */
export type ServerBuild = Pick<HealthResponse, 'build' | 'commit'>;

export interface VersionView {
  /** E.g. `v0.214 · cb04682 · 2026-10-06 · update ready`. */
  text: string;
  updateReady: boolean;
}

/** True when the server runs a later commit on main than this client. */
export function serverIsNewer(client: BuildInfo | null, server: ServerBuild | null): boolean {
  if (!client || server?.build == null || server.commit == null) return false;
  return server.commit !== client.commit && server.build > client.number;
}

export function versionView(
  client: BuildInfo | null,
  server: ServerBuild | null,
  workerWaiting: boolean,
): VersionView {
  const updateReady = workerWaiting || serverIsNewer(client, server);
  const text = formatAppVersion(client);
  return { text: updateReady ? `${text} · update ready` : text, updateReady };
}

export interface AppUpdates {
  /** A new service worker is waiting; `apply` switches to it (update-flow.ts). */
  offer: (apply: () => void) => void;
  readonly workerWaiting: boolean;
  /** `apply` was called and hasn't switched yet (it may be waiting for the hold). */
  readonly applying: boolean;
  /**
   * Switches to the newest version: the waiting worker if there is one, else
   * a reload (page loads are network-first, so it fetches the new build).
   * Never while something holds updates (a recovery code on screen, #47).
   */
  apply: () => void;
}

export function createAppUpdates(deps: {
  hold: Pick<UpdateHold, 'whenReleased'>;
  reload: () => void;
}): AppUpdates {
  let waiting: (() => void) | null = null;
  let applied = false;
  return {
    offer: (apply) => {
      // A newer worker replaced the one being applied (it went redundant
      // while held): this one gets its own tap.
      waiting = apply;
      applied = false;
    },
    get workerWaiting() {
      return waiting !== null;
    },
    get applying() {
      return applied;
    },
    apply: () => {
      if (applied) return;
      applied = true;
      // update-flow's apply waits for the hold itself.
      if (waiting) waiting();
      else deps.hold.whenReleased(deps.reload);
    },
  };
}

/** The app's one update state: pwa.ts offers waiting workers to it. */
export const appUpdates = createAppUpdates({
  hold: updateHold,
  reload: () => {
    window.location.reload();
  },
});
