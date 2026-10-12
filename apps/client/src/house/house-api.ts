import { HouseViewSchema, type HouseView } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';

/**
 * The Keeper's house calls (#381, server: modules/house). `GET /house` is
 * NOT_FOUND while the house is switched off for the player (`HP_HOUSE`).
 */
export const houseApi = {
  get: (mapId: string): Promise<HouseView> =>
    apiCallFor(`/maps/${mapId}/house`, { method: 'GET', schema: HouseViewSchema }),
};

export type HouseApi = typeof houseApi;

/**
 * `POST /maps/:mapId/house/residents` (#381 PR C): moves my squishy into a
 * room of my house, into another room, or out (`roomId` null), and replies
 * with the house. Pass the same `key` to retry it safely (tech spec §5).
 */
export const moveResident = (
  mapId: string,
  squishyId: string,
  roomId: string | null,
  key: string = newIdempotencyKey(),
): Promise<HouseView> =>
  apiCallFor(`/maps/${mapId}/house/residents`, {
    method: 'POST',
    body: { squishyId, roomId },
    schema: HouseViewSchema,
    headers: { 'idempotency-key': key },
  });
