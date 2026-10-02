import { z } from 'zod';
import { ContentIdSchema } from './common.js';

/**
 * One map size (design doc §3): the hex radius for a player count, and how
 * far each home base (Heart Seed tile) sits from the centre.
 */
export const MapLayoutSchema = z
  .strictObject({
    players: z.number().int().min(2).max(4),
    /** Hex radius: the map holds 1 + 3 × radius × (radius + 1) tiles. */
    radius: z.number().int().min(1).max(50),
    /** Steps from the centre to every Heart Seed tile. */
    homeDistance: z.number().int().min(1),
  })
  .refine(
    (l) => l.homeDistance + 1 <= l.radius,
    'home rings must fit inside the map (homeDistance + 1 <= radius)',
  )
  .refine(
    (l) => (6 * l.homeDistance) % l.players === 0,
    'home bases need exactly even spacing: 6 × homeDistance must divide by players',
  );
export type MapLayout = z.infer<typeof MapLayoutSchema>;

/** Wild guardian strength on neutral tiles (design doc §11). */
export const GuardianStrengthSchema = z
  .strictObject({
    /** Strength on tiles right next to a home ring. */
    min: z.number().int().positive(),
    /** Strength cap for ordinary land. */
    max: z.number().int().positive(),
    /** Strength goes up by 1 every this many steps away from the nearest Heart Seed. */
    stepsPerLevel: z.number().int().positive(),
    /** Juniper's Gap: the toughest guardians on the map. */
    gap: z.number().int().positive(),
  })
  .refine((g) => g.min <= g.max, 'min strength must not exceed max')
  .refine((g) => g.gap > g.max, "Juniper's Gap guardians must be the strongest");
export type GuardianStrength = z.infer<typeof GuardianStrengthSchema>;

/** Settings for the seeded map generator (`generateMap`). */
export const MapGenSettingsSchema = z.strictObject({
  /** One layout per supported player count. */
  layouts: z.array(MapLayoutSchema).min(1),
  /** Juniper's Gap covers every tile within this many steps of the centre. */
  gapRadius: z.number().int().min(0),
  /** Terrain for Juniper's Gap tiles. */
  gapTerrain: ContentIdSchema,
  /** Terrain under every Heart Seed tile, so there's always room to build. */
  homeTerrain: ContentIdSchema,
  /**
   * Nodes every home ring gets, regardless of terrain (design doc §11). Each
   * one goes on a different ring tile, so at most 6.
   */
  homeRingNodes: z.array(ContentIdSchema).min(1).max(6),
  /** Average tiles per terrain patch: bigger means fewer, larger patches. */
  patchSize: z.number().int().positive(),
  guardianStrength: GuardianStrengthSchema,
});
export type MapGenSettings = z.infer<typeof MapGenSettingsSchema>;
