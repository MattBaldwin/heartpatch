import { MilestonesResponseSchema, type MilestonesResponse } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/**
 * Keeper milestones (server: modules/milestones). Account-level. A secret
 * milestone's name, goal and title only arrive once it's earned.
 */
export const milestonesApi = {
  get: (): Promise<MilestonesResponse> =>
    apiCallFor('/milestones', { method: 'GET', schema: MilestonesResponseSchema }),

  /**
   * The same, plus whether milestones count on the patch on screen
   * (`countsHere`, #731): the Next-up chip's read.
   */
  getFor: (mapId: string): Promise<MilestonesResponse> =>
    apiCallFor(`/milestones?mapId=${encodeURIComponent(mapId)}`, {
      method: 'GET',
      schema: MilestonesResponseSchema,
    }),

  /** These were celebrated on this device, so no device shows them again. */
  seen: (ids: readonly string[]): Promise<MilestonesResponse> =>
    apiCallFor('/milestones/seen', {
      method: 'POST',
      body: { ids: [...ids] },
      schema: MilestonesResponseSchema,
    }),

  /** Wear an earned title on the profile card, or none (null). */
  equipTitle: (titleId: string | null): Promise<MilestonesResponse> =>
    apiCallFor('/milestones/title', {
      method: 'POST',
      body: { titleId },
      schema: MilestonesResponseSchema,
    }),
};

export type MilestonesApi = typeof milestonesApi;
