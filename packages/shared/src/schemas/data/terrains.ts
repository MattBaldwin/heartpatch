import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';

/**
 * Map terrain (design doc §11–12). Each terrain decides which resource nodes
 * can appear on its tiles. Ids are stored in the `tiles.terrain` column, so
 * never rename one.
 */
export const TerrainSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: DisplayNameSchema,
    description: DescriptionSchema,
    /**
     * Relative share of generated land. 0 means the generator never scatters
     * it; it's only placed on purpose (Juniper's Gap).
     */
    weight: z.number().int().min(0),
    /** Percent chance that a generated tile of this terrain has a resource node. */
    nodeChance: z.number().int().min(0).max(100),
    /** Resources a node on this terrain can yield (one picked per node). */
    nodeResources: z.array(ContentIdSchema),
  })
  .refine(
    (t) => t.nodeChance === 0 || t.nodeResources.length > 0,
    'a terrain with a node chance needs at least one node resource',
  );
export type Terrain = z.infer<typeof TerrainSchema>;
