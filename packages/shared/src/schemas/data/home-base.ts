import { z } from 'zod';
import type { Building } from './buildings.js';

// Home-base rules (design doc §11, §13, §14): the building grid on each home
// tile, take-down refunds and when nightfall is. Data, so tuning them is a
// data edit (CLAUDE.md rule 5).

/** Building kinds a player can put up today (Training Grounds: owner decision 2026-10-06). */
export const BuildableKindSchema = z.enum(['hearthfire', 'habitat', 'training-grounds']);
export type BuildableKind = z.infer<typeof BuildableKindSchema>;

export const HomeBaseRulesSchema = z.strictObject({
  /**
   * Building spots per home tile: spot 0 is the middle, spots 1–6 sit
   * around it in `HEX_DIRECTIONS` order. The Heart Seed and a resource node
   * stand in the middle of their tile, so spot 0 there is taken.
   */
  spotsPerTile: z.literal(7),
  /** Nightfall, in minutes after map-local midnight (design doc §14: 9:00 PM). */
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

/** Can a player build this one now? (Its kind is in `buildableKinds`.) */
export function isBuildable(rules: HomeBaseRules, building: Building): boolean {
  return (rules.buildableKinds as readonly string[]).includes(building.kind);
}
