import { MapViewSchema, PatchStatsSchema, type MapView, type PatchStats } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The map screen's calls (server: modules/maps/routes.ts). */
export const mapApi = {
  /** Everything needed to draw a map, and the event seq it's up to date with. */
  view: (mapId: string): Promise<MapView> =>
    apiCallFor(`/maps/${mapId}/view`, { method: 'GET', schema: MapViewSchema }),
  /** Who's winning what on the patch (#573). */
  stats: (mapId: string): Promise<PatchStats> =>
    apiCallFor(`/maps/${mapId}/stats`, { method: 'GET', schema: PatchStatsSchema }),
};
