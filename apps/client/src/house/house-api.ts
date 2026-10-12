import {
  HouseViewSchema,
  type BuildHouseRequest,
  type ClaimHouseGiftRequest,
  type HouseView,
} from '@heartpatch/shared';
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
      body: { toLevel } satisfies BuildHouseRequest,
      schema: HouseViewSchema,
      headers: { 'idempotency-key': key },
    }),

  /**
   * Opens the day's gift the house showed (#381 H2), and replies with the
   * house. One `key` per tap, the same one on the retry (tech spec §5).
   */
  claimGift: (mapId: string, day: string, key: string): Promise<HouseView> =>
    apiCallFor(`/maps/${mapId}/house/gift/claim`, {
      method: 'POST',
      body: { day } satisfies ClaimHouseGiftRequest,
      schema: HouseViewSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type HouseApi = typeof houseApi;

/**
 * `POST /maps/:mapId/house/residents` (#381 PR C): moves my squishy into a
 * room of my house, into another room, or out (`roomId` null), and replies
 * with the house. One `key` per tap: pass the same one to retry it safely
 * (tech spec §5), like the wardrobe's and the Boutique's commands.
 */
export const moveResident = (
  mapId: string,
  squishyId: string,
  roomId: string | null,
  key: string,
): Promise<HouseView> =>
  apiCallFor(`/maps/${mapId}/house/residents`, {
    method: 'POST',
    body: { squishyId, roomId },
    schema: HouseViewSchema,
    headers: { 'idempotency-key': key },
  });
