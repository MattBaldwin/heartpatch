import {
  CraftResponseSchema,
  GatherResponseSchema,
  InventoryResponseSchema,
  ItemsResponseSchema,
  SettleResponseSchema,
  type CraftResponse,
  type GatherResponse,
  type InventoryResponse,
  type ItemCounts,
  type SettleResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The bag's and the tile panel's calls (server: modules/inventory, modules/gathering). */
export const inventoryApi = {
  /** The bag, gathers and crafts on the go, the seasons on today, and the server's clock (no side effects). */
  get: (mapId: string): Promise<InventoryResponse> =>
    apiCallFor(`/maps/${mapId}/inventory`, { method: 'GET', schema: InventoryResponseSchema }),

  /**
   * Banks whatever has finished (owner decision 2026-10-06: no Collect tap),
   * then the bag, gathers and crafts on the go, the seasons on today, the
   * server's clock, what landed and when to ask again. Safe to repeat.
   */
  settle: (mapId: string): Promise<SettleResponse> =>
    apiCallFor(`/maps/${mapId}/settle`, { method: 'POST', schema: SettleResponseSchema }),

  /** `key` makes a retry on a flaky connection safe (tech spec §5). */
  gather: (mapId: string, at: { q: number; r: number }, key: string): Promise<GatherResponse> =>
    apiCallFor(`/maps/${mapId}/gathers`, {
      method: 'POST',
      body: at,
      schema: GatherResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  craft: (mapId: string, recipeId: string, key: string): Promise<CraftResponse> =>
    apiCallFor(`/maps/${mapId}/crafts`, {
      method: 'POST',
      body: { recipeId },
      schema: CraftResponseSchema,
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
