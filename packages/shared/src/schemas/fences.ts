import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { ItemCountsSchema } from './inventory.js';

// Fences (#203, #204): segments on a tile's hex edges that keep other
// players' challenges out. Built, upgraded, repaired and taken down from the
// tile's panel on the map.

/** A hex edge, in `HEX_DIRECTIONS` order (0 is east, then anticlockwise). */
export const HexEdgeSchema = z.number().int().min(0).max(5);

/**
 * A fence segment as every member sees it on the map: which kind, its level
 * and how much energy it has left. Who owns it is the tile's owner.
 */
export const PublicFenceSchema = z.object({
  id: z.uuid(),
  edge: HexEdgeSchema,
  /** Fence id from the shared building table (`emberwood-fence`). */
  buildingId: ContentIdSchema,
  level: z.number().int().min(1),
  /** Energy left; damage stays until it's repaired (owner decision 2026-10-07). */
  hp: z.number().int().min(1),
  /** Its full energy at this level. */
  maxHp: z.number().int().min(1),
});
export type PublicFence = z.infer<typeof PublicFenceSchema>;

/** A fence segment with its tile, as fence events carry it. */
export const PlacedFenceSchema = z.object({ ...PublicFenceSchema.shape, ...HexSchema.shape });
export type PlacedFence = z.infer<typeof PlacedFenceSchema>;

/** `POST /maps/:mapId/fences`: fence these edges of one of my tiles. */
export const BuildFenceRequestSchema = z.strictObject({
  buildingId: ContentIdSchema,
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  edges: z
    .array(HexEdgeSchema)
    .min(1)
    .max(6)
    .refine((edges) => new Set(edges).size === edges.length, 'each edge once'),
});
export type BuildFenceRequest = z.infer<typeof BuildFenceRequestSchema>;

export const FenceParamsSchema = z.object({ mapId: z.uuid(), fenceId: z.uuid() });

/**
 * What a fence command answers: the tile's segments now and my bag. A
 * take-down also says what came back.
 */
export const FenceTileResponseSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  fences: z.array(PublicFenceSchema),
  items: ItemCountsSchema,
  /** A take-down's refund; empty otherwise. */
  refund: ItemCountsSchema,
});
export type FenceTileResponse = z.infer<typeof FenceTileResponseSchema>;
