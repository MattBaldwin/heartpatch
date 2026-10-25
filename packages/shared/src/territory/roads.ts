import type { HomeBaseRules } from '../schemas/data/home-base.js';
import type { TravelRules } from '../schemas/data/travel.js';
import type { ItemCounts } from '../gathering/index.js';

// Wild Isle roads (#621): a tile attribute (`tile_roads`), level 1 a Path,
// 2 a Road, 3 a Paved road (`TRAVEL_RULES.roads`). Only their owner lays,
// raises, crosses or takes one up; a road never changes hands with its tile.

type RoadRules = Pick<TravelRules, 'roads'>;

/** The highest road level. */
export function topRoadLevel(rules: RoadRules): number {
  return rules.roads.levels.length;
}

/** What laying (level 1) or raising a road to `level` costs; null past the top. */
export function roadCost(level: number, rules: RoadRules): ItemCounts | null {
  if (level < 1) return null;
  return rules.roads.levels[level - 1]?.cost ?? null;
}

/** Everything spent on a road of `level`: each level's cost up to it. */
export function roadSpent(level: number, rules: RoadRules): ItemCounts {
  const spent: Record<string, number> = {};
  for (const step of rules.roads.levels.slice(0, Math.max(0, level))) {
    for (const [id, n] of Object.entries(step.cost)) spent[id] = (spent[id] ?? 0) + n;
  }
  return spent;
}

/**
 * What comes back when a road of `level` comes up (taken up, or lost with
 * its land): the home base's take-down share of what was spent, floored,
 * nothing listed at 0.
 */
export function roadRefund(
  level: number,
  rules: RoadRules,
  homeRules: Pick<HomeBaseRules, 'removeRefundPercent'>,
): ItemCounts {
  const refund: Record<string, number> = {};
  for (const [id, n] of Object.entries(roadSpent(level, rules))) {
    const back = Math.floor((n * homeRules.removeRefundPercent) / 100);
    if (back > 0) refund[id] = back;
  }
  return refund;
}

/**
 * A gatherer's pace on a tile with its owner's road (`workSpeedPercent`'s
 * extra modifier), or null with no road. TUNE: the work tile's own road
 * only, not a neighbour's (the plan left which open).
 */
export function roadSpeedPercent(level: number | null, rules: RoadRules): number | null {
  if (level === null || level < 1) return null;
  const levels = rules.roads.levels;
  return levels[Math.min(level, levels.length) - 1]?.speedPercent ?? null;
}
