import { BattleResponseSchema, type PlayerBattle } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Journeys' calls (server: modules/journeys/routes.ts, #270). */
export const journeyApi = {
  /**
   * Sets off to the trading post at (q, r): starts its journey (`created`), or
   * resumes the battle going, which may be any battle (one at a time).
   */
  start: async (
    mapId: string,
    at: { q: number; r: number },
    key: string,
  ): Promise<{ battle: PlayerBattle; created: boolean }> => {
    let created = false;
    const res = await apiCallFor(`/maps/${mapId}/posts/journey`, {
      method: 'POST',
      body: { q: at.q, r: at.r },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
      onStatus: (status) => {
        created = status === 201;
      },
    });
    return { battle: res.battle, created };
  },
};

export type JourneyApi = typeof journeyApi;
