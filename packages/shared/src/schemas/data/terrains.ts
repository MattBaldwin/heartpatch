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
    /**
     * Nodes added after the main pass (#238), to tiles that got none: each
     * `chance`% in order, rolled per tile from the map seed (shared
     * `extraNodes`). New maps get them when generated and older maps the next
     * time they're read, the same ones either way.
     */
    extraNodes: z
      .array(
        z.strictObject({
          resource: ContentIdSchema,
          chance: z.number().int().min(1).max(100),
        }),
      )
      .optional(),
  })
  .refine(
    (t) => t.nodeChance === 0 || t.nodeResources.length > 0,
    'a terrain with a node chance needs at least one node resource',
  );
export type Terrain = z.infer<typeof TerrainSchema>;

/** Every resource a node on this terrain can yield: the main pass's and the extra ones (#238). */
export function terrainNodeResources(
  terrain: Pick<Terrain, 'nodeResources' | 'extraNodes'>,
): string[] {
  return [...terrain.nodeResources, ...(terrain.extraNodes ?? []).map((e) => e.resource)];
}
