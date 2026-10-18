import type { TerritoryRules } from '../schemas/data/territory.js';

/*
 * The guard level floor (#529): on a rival's tile, every defender (a posted
 * guard or the land's guardian standing in) fights at least at the owner's
 * Partner level plus `guardLevel.partnerBonus`. Only the battle setup's level
 * is lifted; the squishy's stored level never changes. Pure, and only `+` and
 * `max`, so the server and a replay agree to the bit.
 */

/** The top level a battle setup can hold (`BattleSquishySetupSchema`). */
const MAX_BATTLE_LEVEL = 100;

/**
 * The level a rival tile's defenders fight at, at least: the owner's Partner
 * level plus the bonus. Null when there's no Partner level (no floor).
 */
export function watchFloor(
  partnerLevel: number | null,
  rules: TerritoryRules['guardLevel'],
): number | null {
  return partnerLevel === null ? null : partnerLevel + rules.partnerBonus;
}

/**
 * Copies of the team, each at `max(its level, floor)`, capped at 100. A null
 * floor leaves every level as it is.
 */
export function atWatchLevel<T extends { readonly level: number }>(
  team: readonly T[],
  floor: number | null,
): T[] {
  if (floor === null) return team.map((s) => ({ ...s }));
  return team.map((s) => ({ ...s, level: Math.min(MAX_BATTLE_LEVEL, Math.max(s.level, floor)) }));
}
