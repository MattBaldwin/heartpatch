import {
  CollectResponseSchema,
  CraftResponseSchema,
  GatherResponseSchema,
  InventoryResponseSchema,
  ItemsResponseSchema,
  type CollectResponse,
  type CraftResponse,
  type GatherResponse,
  type InventoryResponse,
  type ItemCounts,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The bag's and the tile panel's calls (server: modules/inventory, modules/gathering). */
export const inventoryApi = {
  /** The bag, gathers and crafts on the go, the seasons on today, and the server's clock. */
  get: (mapId: string): Promise<InventoryResponse> =>
    apiCallFor(`/maps/${mapId}/inventory`, { method: 'GET', schema: InventoryResponseSchema }),

  /** `key` makes a retry on a flaky connection safe (tech spec §5). */
  gather: (mapId: string, at: { q: number; r: number }, key: string): Promise<GatherResponse> =>
    apiCallFor(`/maps/${mapId}/gathers`, {
      method: 'POST',
      body: at,
      schema: GatherResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  collectGather: (mapId: string, gatherId: string, key: string): Promise<CollectResponse> =>
    apiCallFor(`/maps/${mapId}/gathers/${gatherId}/collect`, {
      method: 'POST',
      schema: CollectResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  craft: (mapId: string, recipeId: string, key: string): Promise<CraftResponse> =>
    apiCallFor(`/maps/${mapId}/crafts`, {
      method: 'POST',
      body: { recipeId },
      schema: CraftResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  collectCraft: (mapId: string, craftId: string, key: string): Promise<CollectResponse> =>
    apiCallFor(`/maps/${mapId}/crafts/${craftId}/collect`, {
      method: 'POST',
      schema: CollectResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  // Dev builds only (server `HP_DEV_SQUISHY_GRANTS`).
  dev: {
    grant: (mapId: string, items: ItemCounts): Promise<ItemCounts> =>
      apiCallFor(`/maps/${mapId}/dev/items`, {
        method: 'POST',
        body: { items },
        schema: ItemsResponseSchema,
      }).then((res) => res.items),
  },
};

export type InventoryApi = typeof inventoryApi;
