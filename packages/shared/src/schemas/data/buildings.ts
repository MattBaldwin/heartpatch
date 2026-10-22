import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';
import { ElementIdSchema, FeelingIdSchema } from './elements.js';
import { formatDataIssues, type Report } from './issues.js';
import type { JobRules } from './jobs.js';

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
   * stands only on captured land (`checkGameData`). On a building that
   * stands out on the land too (a homestead Crafting Factory, #295), it caps
   * the player's whole patch.
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

/** Heart Coins a building costs each morning it can work (#601). */
const upkeep = z.number().int().min(0).max(500);

/**
 * A resource building (#601, owner decisions 2026-10-22): a homestead
 * building that works its tile's land by itself, no squishy needed. It
 * stands only on land of its `terrain` (or land cleared from it) and makes
 * that terrain's `JOB_RULES.terrainYields` resource. Each level:
 * - `pacePercent`: how fast, as a whole percent of a plain squishy
 *   gatherer's pace (300 = three times as fast);
 * - `storageHours`: how many hours of its own output it holds before it
 *   pauses until the settle collects it;
 * - `upkeep`: Heart Coins each morning it can work (running or full).
 */
export const ResourceBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('resource'),
  terrain: ContentIdSchema,
  levels: levels({
    pacePercent: z.number().int().min(100).max(1000),
    storageHours: z.number().int().min(1).max(240),
    upkeep,
  }),
});

/**
 * The Warehouse (#601): with one standing, paid and joined, its owner's
 * resource buildings from `RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel`
 * up deliver straight to the bag and never fill up.
 */
export const WarehouseBuildingSchema = z.strictObject({
  ...buildingBase,
  kind: z.literal('warehouse'),
  levels: levels({ upkeep }),
});

export const BuildingSchema = z.discriminatedUnion('kind', [
  HearthfireBuildingSchema,
  HabitatBuildingSchema,
  TrainingGroundsBuildingSchema,
  FenceBuildingSchema,
  FactoryBuildingSchema,
  ResourceBuildingSchema,
  WarehouseBuildingSchema,
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
export type ResourceBuilding = z.infer<typeof ResourceBuildingSchema>;
export type ResourceBuildingLevel = ResourceBuilding['levels'][number];
export type WarehouseBuilding = z.infer<typeof WarehouseBuildingSchema>;

/** The buildings that pay Heart Coin upkeep each morning (#601). */
export type UpkeepBuilding = ResourceBuilding | WarehouseBuilding;

/** Does this building pay a morning upkeep? (A resource building or the Warehouse.) */
export function paysUpkeep(building: Building): building is UpkeepBuilding {
  return building.kind === 'resource' || building.kind === 'warehouse';
}

/**
 * How the patch economy's buildings work together (#601), beside their
 * levels in `BUILDINGS`.
 */
export const ResourceBuildingRulesSchema = z.strictObject({
  /**
   * With a paid Warehouse standing, resource buildings at this level and up
   * deliver straight to the bag (owner decision 2026-10-22: level 3+).
   */
  warehouseDeliversFromLevel: z.number().int().min(1).max(10),
});
export type ResourceBuildingRules = z.infer<typeof ResourceBuildingRulesSchema>;

/**
 * Readable problems with the patch economy's buildings, or `[]`: the rules
 * parse; each resource building works a terrain with a land yield
 * (`JOB_RULES.terrainYields`), one building a terrain, a homestead building
 * on one tile; each level is at least as fast, holds at least as much and
 * costs at least as much upkeep as the one below; and there's at most one
 * Warehouse, one a patch.
 */
export function checkResourceBuildings(
  buildings: readonly Building[],
  rules: unknown,
  jobRules: Pick<JobRules, 'terrainYields'>,
): string[] {
  const parsed = ResourceBuildingRulesSchema.safeParse(rules);
  if (!parsed.success) return formatDataIssues(rules, parsed.error);
  const problems: string[] = [];
  const report: Report = (path, message) => {
    problems.push(`${path.join('.')}: ${message}`);
  };
  const terrains = new Set<string>();
  let warehouses = 0;
  for (const b of buildings) {
    if (!paysUpkeep(b)) continue;
    if (b.placement !== 'homestead' || b.maxPerTile !== 1 || b.slot !== 'ring') {
      report([b.id], 'a homestead building that fills its tile (placement, maxPerTile 1, ring)');
    }
    if (b.kind === 'warehouse') {
      warehouses += 1;
      if (b.maxPerHome !== 1) report([b.id, 'maxPerHome'], 'one Warehouse a patch');
      continue;
    }
    if (!jobRules.terrainYields.some((y) => y.terrain === b.terrain)) {
      report([b.id, 'terrain'], `"${b.terrain}" has no land yield to work`);
    }
    if (terrains.has(b.terrain)) report([b.id, 'terrain'], `a second building for "${b.terrain}"`);
    terrains.add(b.terrain);
    b.levels.forEach((level, i) => {
      const below = b.levels[i - 1];
      if (!below) return;
      if (level.pacePercent < below.pacePercent) report([b.id, 'levels', i], 'slower than below');
      if (level.storageHours < below.storageHours) report([b.id, 'levels', i], 'holds less');
      if (level.upkeep < below.upkeep) report([b.id, 'levels', i], 'cheaper upkeep than below');
    });
  }
  if (warehouses > 1) report(['warehouse'], 'more than one Warehouse');
  return problems;
}
