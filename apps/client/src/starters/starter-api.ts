import { MapResponseSchema, SquishyResponseSchema, type OwnedSquishy } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The starter pick's calls (server: modules/starters, and `MapDetail.needsStarter`). */
export const starterApi = {
  /** True until the player picks their starter on this patch. */
  needsStarter: async (mapId: string): Promise<boolean> =>
    (await apiCallFor(`/maps/${mapId}`, { method: 'GET', schema: MapResponseSchema })).map
      .needsStarter,

  /**
   * Whether the pick is needed, and the starter it pre-selects: the
   * player's tutorial Partner (#24), or null.
   */
  pickInfo: async (
    mapId: string,
  ): Promise<{ needsStarter: boolean; preselectSpeciesId: string | null }> => {
    const { map } = await apiCallFor(`/maps/${mapId}`, {
      method: 'GET',
      schema: MapResponseSchema,
    });
    return { needsStarter: map.needsStarter, preselectSpeciesId: map.preselectSpeciesId };
  },

  /** `key` makes a retry after a lost reply safe (tech spec §5). */
  pick: async (mapId: string, speciesId: string, key: string): Promise<OwnedSquishy> =>
    (
      await apiCallFor(`/maps/${mapId}/starter`, {
        method: 'POST',
        body: { speciesId },
        schema: SquishyResponseSchema,
        headers: { 'idempotency-key': key },
      })
    ).squishy,
};

export type StarterApi = typeof starterApi;
