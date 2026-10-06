import { LandTendingResponseSchema, type LandTending } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Land that misses you's calls (server: modules/territory/routes.ts). */
export const landApi = {
  /** My land that misses me and what went wild lately. */
  status: (mapId: string): Promise<LandTending> =>
    apiCallFor(`/maps/${mapId}/territory/tending`, {
      method: 'GET',
      schema: LandTendingResponseSchema,
    }).then((res) => res.tending),

  /** Visit: tends all my land at once. A repeat just tends it again. */
  visit: (mapId: string): Promise<LandTending> =>
    apiCallFor(`/maps/${mapId}/territory/visit`, {
      method: 'POST',
      schema: LandTendingResponseSchema,
    }).then((res) => res.tending),
};

export type LandApi = typeof landApi;
