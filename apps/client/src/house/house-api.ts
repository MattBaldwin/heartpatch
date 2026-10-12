import { HouseViewSchema, type HouseView } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/**
 * The Keeper's house calls (#381, server: modules/house). `GET /house` is
 * NOT_FOUND while the house is switched off for the player (`HP_HOUSE`).
 */
export const houseApi = {
  get: (mapId: string): Promise<HouseView> =>
    apiCallFor(`/maps/${mapId}/house`, { method: 'GET', schema: HouseViewSchema }),
};

export type HouseApi = typeof houseApi;
