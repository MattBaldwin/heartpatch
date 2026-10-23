import {
  BattleResponseSchema,
  CrookedEnterResponseSchema,
  CrookedFixResponseSchema,
  CrookedViewResponseSchema,
  FarHollowViewSchema,
  type CrookedEnterResponse,
  type CrookedFixResponse,
  type CrookedViewResponse,
  type FarHollowView,
  type PlayerBattle,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/**
 * The far Hollow (#306 PR 6; server: modules/far-hollow, and the far road in
 * modules/journeys). `key` makes a retry safe.
 */
export const farHollowApi = {
  /** My far Hollow this season. */
  view: (mapId: string): Promise<FarHollowView> =>
    apiCallFor(`/maps/${mapId}/far-hollow`, { method: 'GET', schema: FarHollowViewSchema }),

  /**
   * Sets off on the far road from the post at (q, r) (`created`), or resumes
   * the battle going, which may be any battle (one at a time).
   */
  road: async (
    mapId: string,
    post: { q: number; r: number },
    key: string,
  ): Promise<{ battle: PlayerBattle; created: boolean }> => {
    let created = false;
    const res = await apiCallFor(`/maps/${mapId}/far-hollow/journey`, {
      method: 'POST',
      body: { q: post.q, r: post.r },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
      onStatus: (status) => {
        created = status === 201;
      },
    });
    return { battle: res.battle, created };
  },

  /** Puts a crooked thing right in the room I'm in (#306 6c): maybe a key, maybe the bloom. */
  fix: (
    mapId: string,
    body: { room: string; thing: string },
    key: string,
  ): Promise<CrookedFixResponse> =>
    apiCallFor(`/maps/${mapId}/far-hollow/fix`, {
      method: 'POST',
      body,
      schema: CrookedFixResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Steps into a room through an open door, or to a lit room I can reach (the dollhouse map). */
  enter: (
    mapId: string,
    body: { room: string; tiptoe: boolean },
    key: string,
  ): Promise<CrookedEnterResponse> =>
    apiCallFor(`/maps/${mapId}/far-hollow/enter`, {
      method: 'POST',
      body,
      schema: CrookedEnterResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Turns a found key in a door of the room I'm in. */
  unlock: (mapId: string, door: string, key: string): Promise<CrookedViewResponse> =>
    apiCallFor(`/maps/${mapId}/far-hollow/unlock`, {
      method: 'POST',
      body: { door },
      schema: CrookedViewResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type FarHollowApi = typeof farHollowApi;
