import { HeartCoinsResponseSchema, type HeartCoins } from '@heartpatch/shared';
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
};

export type HeartCoinsApi = typeof heartCoinsApi;
