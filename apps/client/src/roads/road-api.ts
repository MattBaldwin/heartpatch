import {
  RoadsViewSchema,
  RoadTileResponseSchema,
  type ItemCounts,
  type RoadRequest,
  type RoadsView,
  type RoadTileResponse,
} from '@heartpatch/shared';
import { inventoryApi } from '../inventory/inventory-api.js';
import { apiCallFor } from '../net/api.js';

/** Road calls (server: modules/roads/routes.ts). `key` makes a retry safe (tech spec §5). */
export const roadApi = {
  /** Every road on a Wild Isle. */
  list: (mapId: string): Promise<RoadsView> =>
    apiCallFor(`/maps/${mapId}/roads`, { method: 'GET', schema: RoadsViewSchema }),

  /** My bag, for what the build cards can afford. */
  items: (mapId: string): Promise<ItemCounts> => inventoryApi.get(mapId).then((res) => res.items),

  /** Lays a Path on one of my tiles, raises the road there a level, or takes it up. */
  act: (
    mapId: string,
    action: 'build' | 'upgrade' | 'remove',
    request: RoadRequest,
    key: string,
  ): Promise<RoadTileResponse> =>
    apiCallFor(roadPath(mapId, action), {
      method: 'POST',
      body: request,
      schema: RoadTileResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type RoadApi = typeof roadApi;

/** Where each road command goes (building is the collection itself). */
export function roadPath(mapId: string, action: 'build' | 'upgrade' | 'remove'): string {
  return action === 'build' ? `/maps/${mapId}/roads` : `/maps/${mapId}/roads/${action}`;
}
