import {
  FenceTileResponseSchema,
  type BuildFenceRequest,
  type FenceTileResponse,
  type ItemCounts,
} from '@heartpatch/shared';
import { inventoryApi } from '../inventory/inventory-api.js';
import { apiCallFor } from '../net/api.js';

/** Fence calls (server: modules/fences/routes.ts). `key` makes a retry safe (tech spec §5). */
export const fenceApi = {
  /** My bag, for what the build list can afford. */
  items: (mapId: string): Promise<ItemCounts> => inventoryApi.get(mapId).then((res) => res.items),

  build: (mapId: string, request: BuildFenceRequest, key: string): Promise<FenceTileResponse> =>
    apiCallFor(`/maps/${mapId}/fences`, {
      method: 'POST',
      body: request,
      schema: FenceTileResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Upgrade, repair or take down one segment. */
  act: (
    mapId: string,
    fenceId: string,
    action: 'upgrade' | 'repair' | 'remove',
    key: string,
  ): Promise<FenceTileResponse> =>
    apiCallFor(`/maps/${mapId}/fences/${fenceId}/${action}`, {
      method: 'POST',
      schema: FenceTileResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type FenceApi = typeof fenceApi;
