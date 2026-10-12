import { HouseViewSchema, type HouseView } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/**
 * The Keeper's house calls (#381, server: modules/house). `GET /house` is
 * NOT_FOUND while the house is switched off for the player (`HP_HOUSE`).
 */
export const houseApi = {
  get: (mapId: string): Promise<HouseView> =>
    apiCallFor(`/maps/${mapId}/house`, { method: 'GET', schema: HouseViewSchema }),

  /**
   * Builds the next level (it must be `level + 1`). `key` makes a retry on a
   * flaky connection safe (tech spec §5): the server replays the first reply.
   */
  build: (mapId: string, toLevel: number, key: string): Promise<HouseView> =>
    apiCallFor(`/maps/${mapId}/house/build`, {
      method: 'POST',
      body: { toLevel },
      schema: HouseViewSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type HouseApi = typeof houseApi;
