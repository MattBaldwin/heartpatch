import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';
import { ElementIdSchema, FeelingIdSchema } from './elements.js';

/** Each upgrade level's cost; level 1 is the build cost (design doc §13). */
const levels = <T extends z.ZodRawShape>(shape: T) =>
  z.array(z.strictObject({ cost: ResourceCostSchema, ...shape })).min(1);

const buildingBase = {
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  /**
   * Seasonal buildings can only be built during their season. One already
   * built stays and keeps working after the season ends (keepsakes, §15).
   */
  season: ContentIdSchema.optional(),
  /**
   * How many of this building one home base can have. Required unless it
   * stands only on captured land (`checkGameData`).
   */
  maxPerHome: z.number().int().positive().optional(),
  /**
   * Where it can stand (#202): `home` on the home base only; `land` only on
   * captured land outside it (Hearthfires: the Heart Seed keeps home safe,
   * owner decision 2026-10-07); `owned` on any tile its owner holds;
   * `homestead` only on a homestead joined to its owner's home (#199;
   * Training Grounds, owner decision 4 on #277).
   */
  placement: z.enum(['home', 'land', 'owned', 'homestead']),
  /**
   * How many can stand on one tile outside the home base. Required unless
   * it's `placement: 'home'` (`checkGameData`).
   */
  maxPerTile: z.number().int().positive().optional(),
  /**
   * Which spots it takes on a tile (#204): the middle (`centre`, lights such
   * as a Hearthfire), the six around it (`ring`), or a hex edge (`edge`,
   * fences, #203).
   */
  slot: z.enum(['centre', 'ring', 'edge']),
  /**
   * Percent of what it cost that comes back when it's taken down (rounded
   * down per item). Defaults to `HOME_BASE_RULES.removeRefundPercent`.
   */
  refundPercent: z.number().int().min(0).max(100).optional(),
};

/**
 * Hearthfire (design doc §13–14, tech spec §7): stores up to `maxFuelNights`
 * nights of fuel and burns `fuelPerNight` at each nightfall.
 */
export const HearthfireBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('hearthfire'),
  fuelResource: ContentIdSchema,
  fuelPerNight: z.number().int().positive(),
  maxFuelNights: z.number().int().positive(),
  /** `safeRadius` is in hex tiles; every fire lights at least its ring (#277 guardrail a). */
  levels: levels({ safeRadius: z.number().int().min(1).max(6) }),
});

/** Habitats house squishies; matching tags earn the habitat multiplier. */
export const HabitatBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('habitat'),
  tags: z
    .strictObject({
      elements: z.array(ElementIdSchema),
      feelings: z.array(FeelingIdSchema),
    })
    .refine((t) => t.elements.length + t.feelings.length > 0, 'a habitat needs at least one tag'),
  levels: levels({ capacity: z.number().int().positive() }),
});

/** Training Grounds: a small passive XP trickle for assigned squishies. */
export const TrainingGroundsBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('training-grounds'),
  levels: levels({
    capacity: z.number().int().positive(),
    xpPerHour: z.number().int().positive(),
  }),
});

/**
 * A fence (#203): segments on a tile's hex edges that keep other players'
 * challenges out. Its material sets its `element` (owner decision
 * 2026-10-07: wood is weak to Fire, stone to Water). Each level is a stat
 * block a challenger's squishy battles (`hp` is its energy bar, `defense`
 * its toughness); a fence never makes a move.
 */
export const FenceBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('fence'),
  element: ElementIdSchema,
  levels: levels({
    hp: z.number().int().min(1).max(9999),
    defense: z.number().int().min(1).max(9999),
  }),
});

/**
 * The Crafting Factory (#294, owner decision 2026-10-08): batches of the
 * pot's recipes that go on while the kid is away. `queues` is how many
 * batches run at once at that level.
 */
export const FactoryBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('factory'),
  levels: levels({ queues: z.number().int().min(1).max(8) }),
});

export const BuildingSchema = z.discriminatedUnion('kind', [
  HearthfireBuildingSchema,
  HabitatBuildingSchema,
  TrainingGroundsBuildingSchema,
  FenceBuildingSchema,
  FactoryBuildingSchema,
]);
export type Building = z.infer<typeof BuildingSchema>;
export type BuildingKind = Building['kind'];
export type BuildingSlot = Building['slot'];
export type BuildingPlacement = Building['placement'];

/** Can this building stand on a home tile? (Not one for captured land or homesteads only.) */
export function buildsAtHome(building: Pick<Building, 'placement'>): boolean {
  return building.placement === 'home' || building.placement === 'owned';
}
export type HearthfireBuilding = z.infer<typeof HearthfireBuildingSchema>;
export type HabitatBuilding = z.infer<typeof HabitatBuildingSchema>;
export type FenceBuilding = z.infer<typeof FenceBuildingSchema>;
