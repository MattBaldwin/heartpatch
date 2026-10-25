import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';

/** The kinds of water a terrain can be (Wild Isle, #621; `Terrain.water`). */
export const WaterKindSchema = z.enum(['deep', 'river', 'lake']);
export type WaterKind = z.infer<typeof WaterKindSchema>;

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
    /**
     * Water (Wild Isle, #621): `deep` (the ocean), `river` or `lake` (a Wild
     * Isle lake, `wild-lake`). A water tile is never land: nobody claims it,
     * it yields nothing and holds no node, guardian or spawn, and only a
     * `travel` building stands on it (a Bridge on a river). Left out on land,
     * including Cozy's `lake`, which stays claimable land. Check it with
     * `isWater`.
     */
    water: WaterKindSchema.optional(),
  })
  .refine(
    (t) => t.nodeChance === 0 || t.nodeResources.length > 0,
    'a terrain with a node chance needs at least one node resource',
  )
  .refine(
    (t) =>
      t.water === undefined ||
      (t.weight === 0 &&
        t.nodeChance === 0 &&
        t.nodeResources.length === 0 &&
        (t.extraNodes ?? []).length === 0),
    'a water terrain is only placed on purpose (weight 0) and holds no nodes',
  );
export type Terrain = z.infer<typeof TerrainSchema>;

/** Is this terrain water (Wild Isle, #621)? The one check: never land, never claimable. */
export function isWater(terrain: Pick<Terrain, 'water'> | undefined): boolean {
  return terrain?.water !== undefined;
}

/** Every resource a node on this terrain can yield: the main pass's and the extra ones (#238). */
export function terrainNodeResources(
  terrain: Pick<Terrain, 'nodeResources' | 'extraNodes'>,
): string[] {
  return [...terrain.nodeResources, ...(terrain.extraNodes ?? []).map((e) => e.resource)];
}
