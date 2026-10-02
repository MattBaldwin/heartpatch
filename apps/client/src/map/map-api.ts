import { MapViewSchema, type MapView } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The map screen's calls (server: modules/maps/routes.ts). */
export const mapApi = {
  /** Everything needed to draw a map, and the event seq it's up to date with. */
  view: (mapId: string): Promise<MapView> =>
    apiCallFor(`/maps/${mapId}/view`, { method: 'GET', schema: MapViewSchema }),
};
