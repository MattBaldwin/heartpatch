import { BattleResponseSchema, type PlayerBattle } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Journeys' calls (server: modules/journeys/routes.ts, #270). */
export const journeyApi = {
  /** Sets off to the trading post at (q, r): starts its journey (or resumes the battle going). */
  start: (mapId: string, at: { q: number; r: number }, key: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/posts/journey`, {
      method: 'POST',
      body: { q: at.q, r: at.r },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.battle),
};

export type JourneyApi = typeof journeyApi;
