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
  /** How many of this building one home base can have. */
  maxPerHome: z.number().int().positive(),
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
  /** `safeRadius` is in hex tiles. */
  levels: levels({ safeRadius: z.number().int().min(0).max(6) }),
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

export const BuildingSchema = z.discriminatedUnion('kind', [
  HearthfireBuildingSchema,
  HabitatBuildingSchema,
  TrainingGroundsBuildingSchema,
]);
export type Building = z.infer<typeof BuildingSchema>;
export type BuildingKind = Building['kind'];
export type HearthfireBuilding = z.infer<typeof HearthfireBuildingSchema>;
export type HabitatBuilding = z.infer<typeof HabitatBuildingSchema>;
