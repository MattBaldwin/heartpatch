import { z } from 'zod';
import { CommunityPlacementRulesSchema } from './communities.js';
import { ContentIdSchema } from './common.js';

/**
 * One map size (design doc §3): the hex radius for a player count, and how
 * far each home base (Heart Seed tile) sits from the centre.
 */
export const MapLayoutSchema = z
  .strictObject({
    players: z.number().int().min(2).max(6),
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

/**
 * Trading posts (#30, #269; owner decisions 2026-10-07): 4 shared posts a
 * map (one per home on a bigger map, #318), never owned, spread fairly so every home slot has one nearby. Placed
 * by `placeTradingPosts`, on new maps when they're made and on older maps by
 * the server's boot pass, by the same rule.
 */
export const TradingPostRulesSchema = z
  .strictObject({
    /** Posts on every patch map; a map with more homes gets one per home (#318). */
    perMap: z.number().int().min(1).max(8),
    /** Every home slot has a post at most this many steps from its Heart Seed. */
    maxFromSeed: z.number().int().min(2),
    /** No post closer than this to any Heart Seed (never touching a home ring on day 1). */
    minFromSeed: z.number().int().min(2),
    /** Posts stand at least this many steps apart. */
    minApart: z.number().int().min(1),
    /** What each post is called, by its index on the map (in (q, r) order). */
    names: z.array(z.string().min(1).max(40)).min(1),
  })
  .refine((t) => t.minFromSeed <= t.maxFromSeed, 'minFromSeed must not exceed maxFromSeed')
  .refine((t) => t.names.length >= t.perMap, 'every post needs a name');
export type TradingPostRules = z.infer<typeof TradingPostRulesSchema>;

/** A `[min, max]` range of whole numbers, both inclusive. */
const IntRangeSchema = z
  .tuple([z.number().int().min(0), z.number().int().min(0)])
  .refine(([min, max]) => min <= max, 'a range needs min <= max');

/**
 * One Wild Isle size (#621): the hex radius for a player count, how far each
 * Heart Seed sits from the centre, and how many rings round the edge are sea.
 */
export const WildIsleLayoutSchema = z
  .strictObject({
    players: z.number().int().min(2).max(6),
    /** Hex radius, sea included: the map holds 1 + 3 × radius × (radius + 1) tiles. */
    radius: z.number().int().min(1).max(50),
    /** Steps from the centre to every Heart Seed tile. */
    homeDistance: z.number().int().min(1),
    /** Rings of `ocean` round the edge (the offshore isles stand in them). */
    oceanRings: z.number().int().min(1),
  })
  .refine(
    (l) => (6 * l.homeDistance) % l.players === 0,
    'home bases need exactly even spacing: 6 × homeDistance must divide by players',
  );
export type WildIsleLayout = z.infer<typeof WildIsleLayoutSchema>;

/**
 * The Wild Isle generator (#621, `generateWildIsle`): an island ringed by
 * coast and sea, with rivers, lakes (`wild-lake`, real water) and offshore
 * isles. Cozy Patches never read it.
 */
export const WildIsleMapGenSchema = z
  .strictObject({
    layouts: z.array(WildIsleLayoutSchema).min(1),
    /** Rings of `coast` just inside the sea. */
    coastRing: z.number().int().min(1),
    oceanTerrain: ContentIdSchema,
    coastTerrain: ContentIdSchema,
    riverTerrain: ContentIdSchema,
    lakeTerrain: ContentIdSchema,
    /** No water this close to a Heart Seed: the home ring and the never-fade ring stay land. */
    waterMinFromSeed: z.number().int().min(2),
    /** Every Heart Seed has a river or lake at most this many steps away. */
    homeWaterSteps: z.number().int().min(2),
    rivers: z.strictObject({
      /** Rivers on the island; each one runs past its own home on the way to the sea. */
      count: IntRangeSchema,
      /** Centre steps a river's spring may sit at. */
      sourceRing: IntRangeSchema,
      /** The spring's ring of hills: this terrain. */
      sourceTerrain: ContentIdSchema,
      /** Chance (%) a river widens into a lake on its way down. */
      lakePercent: z.number().int().min(0).max(100),
    }),
    lakes: z.strictObject({
      /** Lakes on the island, the river lakes included. */
      count: IntRangeSchema,
      /** Tiles in one lake. */
      size: IntRangeSchema,
    }),
    isles: z.strictObject({
      count: IntRangeSchema,
      size: IntRangeSchema,
      /** Sea rings between the coast and an isle (Wave 1 can't reach them). */
      offshore: z.number().int().min(1),
    }),
    /** Every home's land (non-water steps from its seed) holds at least this many tiles. */
    minRegionLand: z.number().int().min(1),
    /** Each home's share of the claimable land is within this % of the average. */
    landBandPercent: z.number().int().min(0).max(100),
    /** Water layouts tried before giving up with a `RangeError`. */
    attempts: z.number().int().min(1).max(500),
  })
  .refine(
    (w) => w.layouts.every((l) => l.homeDistance + w.waterMinFromSeed <= landRadius(w, l)),
    "every home's water-free ring must fit on the land",
  )
  .refine(
    (w) => w.layouts.every((l) => w.isles.offshore < l.oceanRings),
    'the isles need a sea ring to stand in past `offshore`',
  )
  .refine(
    (w) => w.homeWaterSteps >= w.waterMinFromSeed,
    'homeWaterSteps must reach past waterMinFromSeed',
  );
export type WildIsleMapGen = z.infer<typeof WildIsleMapGenSchema>;

/** The outermost ring of a Wild Isle that's neither coast nor sea. */
export function landRadius(
  rules: { readonly coastRing: number },
  layout: { readonly radius: number; readonly oceanRings: number },
): number {
  return layout.radius - layout.oceanRings - rules.coastRing;
}

/** Settings for the seeded map generator (`generateMap`). */
export const MapGenSettingsSchema = z
  .strictObject({
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
    tradingPosts: TradingPostRulesSchema,
    /** Hollowed Communities (#306): where the grey villages go. */
    communities: CommunityPlacementRulesSchema,
    /** The Wild Isle generator (#621); absent: no Wild Isles. */
    wildIsle: WildIsleMapGenSchema.optional(),
  })
  .refine(
    (m) =>
      m.tradingPosts.names.length >=
      Math.max(m.tradingPosts.perMap, ...m.layouts.map((l) => l.players)),
    // A map has one post per home at least (#318), each with its own name.
    'every post on the biggest layout needs a name',
  );
export type MapGenSettings = z.infer<typeof MapGenSettingsSchema>;
