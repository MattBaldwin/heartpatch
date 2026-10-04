import { CinematicResponseSchema, type CinematicState } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The opening cinematic's calls to `/api/v1/cinematic` (server: modules/cinematic/routes.ts). */
export const cinematicApi = {
  /** Whether the player has seen it. */
  get: async (): Promise<CinematicState> =>
    (await apiCallFor('/cinematic', { method: 'GET', schema: CinematicResponseSchema })).cinematic,

  /** Watched to the end, or skipped: remembered on the account (the first time stays). */
  markSeen: async (): Promise<CinematicState> =>
    (await apiCallFor('/cinematic/seen', { method: 'POST', schema: CinematicResponseSchema }))
      .cinematic,
};

export type CinematicApi = typeof cinematicApi;
