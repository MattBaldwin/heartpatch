import {
  BattleResponseSchema,
  FarHollowSearchResponseSchema,
  FarHollowTileViewSchema,
  FarHollowViewSchema,
  type FarHollowSearchResponse,
  type FarHollowTileView,
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

  /** Sets off on the far road from the post at (q, r) (or resumes the battle going). */
  road: (mapId: string, post: { q: number; r: number }, key: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/far-hollow/journey`, {
      method: 'POST',
      body: { q: post.q, r: post.r },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.battle),

  /** One of its tiles up close, as the explore view of a grey Hollow tile. */
  tile: (mapId: string, index: number): Promise<FarHollowTileView> =>
    apiCallFor(`/maps/${mapId}/far-hollow/tiles/${String(index)}`, {
      method: 'GET',
      schema: FarHollowTileViewSchema,
    }),

  /** Searches one spot; the server rolls what's found (CLAUDE.md rule 1). */
  search: (
    mapId: string,
    at: { tile: number; spot: number },
    key: string,
  ): Promise<FarHollowSearchResponse> =>
    apiCallFor(`/maps/${mapId}/far-hollow/search`, {
      method: 'POST',
      body: at,
      schema: FarHollowSearchResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type FarHollowApi = typeof farHollowApi;
