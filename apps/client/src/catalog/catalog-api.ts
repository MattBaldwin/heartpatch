import { CatalogResponseSchema, type Catalog } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The catalog screen's calls (server: modules/spawns/routes.ts). */
export const catalogApi = {
  /** What the player has seen and befriended on this patch. */
  get: (mapId: string): Promise<Catalog> =>
    apiCallFor(`/maps/${mapId}/catalog`, { method: 'GET', schema: CatalogResponseSchema }).then(
      (res) => res.catalog,
    ),
};
