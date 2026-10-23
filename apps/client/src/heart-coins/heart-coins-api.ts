import { HeartCoinsResponseSchema, HomeResponseSchema, type HeartCoins } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Heart Coins (server: modules/heart-coins, #601): my balance on one patch. */
export const heartCoinsApi = {
  get: async (mapId: string): Promise<HeartCoins> =>
    (
      await apiCallFor(`/maps/${mapId}/heart-coins`, {
        method: 'GET',
        schema: HeartCoinsResponseSchema,
      })
    ).heartCoins,

  /**
   * The order my upkeep buildings pay in when Heart Coins run short, first
   * first (#601, owner decision Q5; server: modules/buildings). `key` makes
   * a retry safe.
   */
  upkeepOrder: async (
    mapId: string,
    buildingIds: readonly string[],
    key: string,
  ): Promise<void> => {
    await apiCallFor(`/maps/${mapId}/buildings/upkeep-order`, {
      method: 'POST',
      body: { buildingIds },
      schema: HomeResponseSchema,
      headers: { 'idempotency-key': key },
    });
  },
};

export type HeartCoinsApi = typeof heartCoinsApi;
