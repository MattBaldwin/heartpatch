import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { ItemCountsSchema } from './inventory.js';
import { OwnedSquishySchema } from './squishies.js';

/*
 * The starter pick API (owner decision 2026-10-03). `MapDetail.needsStarter`
 * tells the client to ask; the pick replies with the new squishy and
 * Sprout's gift, if this was the account's first pick.
 */

/** `POST /api/v1/maps/:mapId/starter`: one of `STARTERS`, once per membership. */
export const PickStarterRequestSchema = z.strictObject({ speciesId: ContentIdSchema });
export type PickStarterRequest = z.infer<typeof PickStarterRequestSchema>;

export const PickStarterResponseSchema = z.object({
  squishy: OwnedSquishySchema,
  /**
   * What Sprout tucked into this patch's bag with the pick (`STARTERS.firstPickGift`):
   * only on the account's very first starter pick, else empty.
   */
  gift: ItemCountsSchema,
});
export type PickStarterResponse = z.infer<typeof PickStarterResponseSchema>;
