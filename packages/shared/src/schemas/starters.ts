import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';

/*
 * The starter pick API (owner decision 2026-10-03). `MapDetail.needsStarter`
 * tells the client to ask; the pick replies with the new squishy
 * (`SquishyResponseSchema`).
 */

/** `POST /api/v1/maps/:mapId/starter`: one of `STARTERS`, once per membership. */
export const PickStarterRequestSchema = z.strictObject({ speciesId: ContentIdSchema });
export type PickStarterRequest = z.infer<typeof PickStarterRequestSchema>;
