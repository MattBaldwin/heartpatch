import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { RoadLevelSchema } from './events.js';
import { ItemCountsSchema } from './inventory.js';

// Wild Isle roads (#621): a tile attribute, laid, raised and taken up by
// the tile's owner. Land is public, so every member sees whose road is where
// and its level; what it cost stays with its owner.

/** `POST /maps/:mapId/roads`, `…/roads/upgrade`, `…/roads/remove`: which of my tiles. */
export const RoadRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type RoadRequest = z.infer<typeof RoadRequestSchema>;

/** A road on the map: whose and how good. */
export const PublicRoadSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  ownerUserId: z.uuid(),
  level: RoadLevelSchema,
});
export type PublicRoad = z.infer<typeof PublicRoadSchema>;

/** `GET /maps/:mapId/roads`: every road on a Wild Isle (`NOT_FOUND` on a Cozy Patch). */
export const RoadsViewSchema = z.object({ roads: z.array(PublicRoadSchema) });
export type RoadsView = z.infer<typeof RoadsViewSchema>;

/** A road command's answer: the tile's road now (null once taken up) and my bag. */
export const RoadTileResponseSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  road: z.object({ level: RoadLevelSchema }).nullable(),
  items: ItemCountsSchema,
  /** A take-up's refund; empty otherwise. */
  refund: ItemCountsSchema,
});
export type RoadTileResponse = z.infer<typeof RoadTileResponseSchema>;
