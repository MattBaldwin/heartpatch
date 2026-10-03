import { TutorialResponseSchema, type TutorialState } from '@heartpatch/shared';
import { careApi } from '../care/care-api.js';
import { apiCall, apiCallFor } from '../net/api.js';

/** The tutorial's calls to `/api/v1/tutorial` (server: modules/tutorial/routes.ts). */
export const tutorialApi = {
  /** Where the player is: what the client resumes from. */
  state: async (): Promise<TutorialState> =>
    (await apiCallFor('/tutorial', { method: 'GET', schema: TutorialResponseSchema })).tutorial,

  /** The first run, or the one already going. */
  start: async (): Promise<TutorialState> =>
    (await apiCallFor('/tutorial/start', { method: 'POST', schema: TutorialResponseSchema }))
      .tutorial,

  /** A fresh run from the first step (Settings). */
  replay: async (): Promise<TutorialState> =>
    (await apiCallFor('/tutorial/replay', { method: 'POST', schema: TutorialResponseSchema }))
      .tutorial,

  /** Ends the run; only after finishing once. */
  skip: async (): Promise<TutorialState> =>
    (await apiCallFor('/tutorial/skip', { method: 'POST', schema: TutorialResponseSchema }))
      .tutorial,

  /** The player read a talk-only step; `tutorial.advanced` follows over live sync. */
  acknowledge: async (stepId: string): Promise<void> => {
    await apiCall('/tutorial/acknowledge', { method: 'POST', body: { stepId }, schema: null });
  },

  /** Night falls on the Glade (its nightfall step only); `tutorial.advanced` follows. */
  nightfall: async (): Promise<void> => {
    await apiCall('/tutorial/nightfall', { method: 'POST', schema: null });
  },

  /** Names the Partner (care's rename, #20); `key` makes a retry safe. */
  name: async (mapId: string, squishyId: string, nickname: string, key: string): Promise<void> => {
    await careApi.rename(mapId, squishyId, nickname, key);
  },
};

export type TutorialApi = typeof tutorialApi;
