import {
  BattleResponseSchema,
  TerritoryResponseSchema,
  type PlayerBattle,
  type SetDefendersRequest,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Territory's calls (server: modules/territory/routes.ts). */
export const territoryApi = {
  /** Tries left today, my shield, who stands watch where, and the server's clock. */
  status: (mapId: string): Promise<TerritoryStatus> =>
    apiCallFor(`/maps/${mapId}/territory`, {
      method: 'GET',
      schema: TerritoryResponseSchema,
    }).then((res) => res.territory),

  /** Claims or challenges a tile: starts its battle (or resumes the one going). */
  attack: (mapId: string, at: { q: number; r: number }, key: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/attacks`, {
      method: 'POST',
      body: { q: at.q, r: at.r },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.battle),

  /** Who stands watch on one of my tiles. */
  setDefenders: (
    mapId: string,
    request: SetDefendersRequest,
    key: string,
  ): Promise<TerritoryStatus> =>
    apiCallFor(`/maps/${mapId}/defenders`, {
      method: 'POST',
      body: request,
      schema: TerritoryResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.territory),
};

export type TerritoryApi = typeof territoryApi;
