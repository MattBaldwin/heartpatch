import type { JobsView } from '@heartpatch/shared';
import type { JobsApi } from './jobs-api.js';

// One feed of my jobs views (#393): every view, job change and team change
// the sheets or the map read passes through `api`, so the map's badges and
// the home's moods follow a job change at once. Only the newest view asked
// for on each map reaches the listeners: a slow read can't roll back a job
// just set, and nothing asked before `reset` (another player signed in) gets
// through.

export interface ViewFeed {
  /** The jobs API, every view it returns also handed to the listeners. */
  readonly api: JobsApi;
  listen: (listener: (mapId: string, view: JobsView) => void) => void;
  /** Drops every view still on its way (the player changed). */
  reset: () => void;
}

export function createViewFeed(base: JobsApi): ViewFeed {
  const listeners = new Set<(mapId: string, view: JobsView) => void>();
  let asked = 0;
  /** Views asked at or before this were for a player who has gone. */
  let fence = 0;
  /** The newest view handed on, per map. */
  const shown = new Map<string, number>();

  const fed = async (mapId: string, call: Promise<JobsView>): Promise<JobsView> => {
    asked += 1;
    const n = asked;
    const view = await call;
    if (n > fence && n > (shown.get(mapId) ?? 0)) {
      shown.set(mapId, n);
      for (const listener of listeners) listener(mapId, view);
    }
    return view;
  };

  return {
    api: {
      view: (mapId) => fed(mapId, base.view(mapId)),
      setJob: (mapId, squishyId, job, key) => fed(mapId, base.setJob(mapId, squishyId, job, key)),
      setTeam: (mapId, squishyIds, key) => fed(mapId, base.setTeam(mapId, squishyIds, key)),
    },
    listen: (listener) => {
      listeners.add(listener);
    },
    reset: () => {
      fence = asked;
      shown.clear();
    },
  };
}
