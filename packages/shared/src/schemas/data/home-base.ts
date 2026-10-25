import { z } from 'zod';
import { buildsOnPatchType, type Building } from './buildings.js';
import { DEFAULT_PATCH_TYPE, type PatchType } from '../../patch-types/patch-type.js';

// Home-base rules (design doc §11, §13, §14): the building grid on each home
// tile, take-down refunds and when nightfall is. Data, so tuning them is a
// data edit (CLAUDE.md rule 5).

/**
 * Building kinds a player can put up today (Training Grounds: owner decision
 * 2026-10-06; the Crafting Factory: #294; resource buildings: #601 PR 7; the
 * Warehouse: #601 PR 9; bridges and ferry docks: #621 W1-5b, Wild Isle only by
 * their `patchTypes`). The other Wild Isle kinds (#621) join here, and in
 * `HOME_BASE_RULES.buildableKinds`, with the lane that builds each one.
 */
export const BuildableKindSchema = z.enum([
  'hearthfire',
  'habitat',
  'training-grounds',
  'fence',
  'factory',
  'resource',
  'warehouse',
  'travel',
]);
export type BuildableKind = z.infer<typeof BuildableKindSchema>;

export const HomeBaseRulesSchema = z.strictObject({
  /**
   * Building spots per home tile: spot 0 is the middle, spots 1–6 sit
   * around it in `HEX_DIRECTIONS` order. The Heart Seed and a resource node
   * stand in the middle of their tile, so spot 0 there is taken.
   */
  spotsPerTile: z.literal(7),
  /** Nightfall, in minutes after map-local midnight (design doc §14: 7:00 PM, #277). */
  nightfallMinute: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 - 1),
  /** Percent of a building's cost that comes back when it's taken down (rounded down). */
  removeRefundPercent: z.number().int().min(0).max(100),
  /** What can be built (other kinds are in the data but not playable yet). */
  buildableKinds: z.array(BuildableKindSchema).min(1),
});
export type HomeBaseRules = z.infer<typeof HomeBaseRulesSchema>;

/**
 * Can a player build this one now, on a patch of this type? (Its kind is in
 * `buildableKinds`, and its `patchTypes` allow the patch's type; a Cozy
 * Patch when left out, #621.)
 */
export function isBuildable(
  rules: HomeBaseRules,
  building: Building,
  patchType: PatchType = DEFAULT_PATCH_TYPE,
): boolean {
  return (
    (rules.buildableKinds as readonly string[]).includes(building.kind) &&
    buildsOnPatchType(building, patchType)
  );
}
