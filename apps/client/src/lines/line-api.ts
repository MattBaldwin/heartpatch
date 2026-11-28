import {
  LinesViewSchema,
  LineTileResponseSchema,
  type ItemCounts,
  type LineRequest,
  type LinesView,
  type LineTileResponse,
} from '@heartpatch/shared';
import { inventoryApi } from '../inventory/inventory-api.js';
import { apiCallFor } from '../net/api.js';

/**
 * Wire and rail calls (#874; server: modules/lines/routes.ts). The client
 * sends what to lay where; the server checks the land, reach, cost and
 * research and works out which wires carry power. `key` makes a retry safe
 * (tech spec §5).
 */
export const lineApi = {
  /** Every wire and rail on a Clockwork Isle (`NOT_FOUND` on any other patch). */
  list: (mapId: string): Promise<LinesView> =>
    apiCallFor(`/maps/${mapId}/lines`, { method: 'GET', schema: LinesViewSchema }),

  /** My bag, for what the build cards can afford. */
  items: (mapId: string): Promise<ItemCounts> => inventoryApi.get(mapId).then((res) => res.items),

  /** Lays a wire or rail on one of my tiles, raises a rail a level, or takes a line up. */
  act: (
    mapId: string,
    action: 'build' | 'upgrade' | 'remove',
    request: LineRequest,
    key: string,
  ): Promise<LineTileResponse> =>
    apiCallFor(linePath(mapId, action), {
      method: 'POST',
      body: request,
      schema: LineTileResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type LineApi = typeof lineApi;

/** Where each line command goes (laying is the collection itself). */
export function linePath(mapId: string, action: 'build' | 'upgrade' | 'remove'): string {
  return action === 'build' ? `/maps/${mapId}/lines` : `/maps/${mapId}/lines/${action}`;
}
