import { hexKey, type Hex, type HexKey } from '../hex/index.js';
import type { RailRules } from '../schemas/data/rails.js';
import type { TravelRules } from '../schemas/data/travel.js';
import { powerReach, type PowerTile } from './power.js';
import type { RoadSpot } from './reach.js';

// Clockwork Isle rails (#874): a rail is a road with its own levels
// (`RAIL_RULES`). They feed the supply line home (`supplyMap`) as road
// spots, so claiming along rails and a gatherer's speed-up need no second
// reach rule: each rail level is folded in as one more road level above
// the road levels, with its own `reach` and `speedPercent`.

/** A rail (`tile_lines` kind `rail`): where, whose, and its level (1 Rail, 2 Tidy rail). */
export interface RailSpot extends Hex {
  readonly ownerUserId: string;
  readonly level: number;
}

/** The road levels `supplyMap` reads: the travel rules' own, then each rail level. */
type SupplyRoadRules = Pick<TravelRules, 'roads'>;

/**
 * The supply line's roads with rails in: the rules gain one road level per
 * rail level (after the road levels), and each rail becomes a road spot at
 * its folded level. A tile with both a road and a rail of the same owner
 * keeps the one that reaches further (the rail on a tie). No rail rules
 * (Cozy and Wild): the roads and rules as given, untouched.
 */
export function withRails<R extends SupplyRoadRules>(
  roads: readonly RoadSpot[],
  rails: readonly RailSpot[],
  travel: R,
  railRules: RailRules | null,
): { roads: RoadSpot[]; rules: R } {
  if (!railRules || rails.length === 0) return { roads: [...roads], rules: travel };
  const base = travel.roads.levels.length;
  const levels = [
    ...travel.roads.levels,
    ...railRules.levels.map(({ cost, reach, speedPercent }) => ({ cost, reach, speedPercent })),
  ];
  const reachOf = (spot: RoadSpot) => levels[Math.min(spot.level, levels.length) - 1]?.reach ?? 0;
  const best = new Map<string, RoadSpot>();
  const offer = (spot: RoadSpot) => {
    const key = `${hexKey(spot)}|${spot.ownerUserId}`;
    const held = best.get(key);
    if (!held || reachOf(spot) >= reachOf(held)) best.set(key, spot);
  };
  for (const road of roads) offer(road);
  for (const rail of rails) {
    const level = Math.min(Math.max(rail.level, 1), railRules.levels.length);
    offer({ q: rail.q, r: rail.r, ownerUserId: rail.ownerUserId, level: base + level });
  }
  return {
    roads: [...best.values()],
    rules: { ...travel, roads: { ...travel.roads, levels } },
  };
}

/** A gatherer's pace on a tile with its owner's rail of `level`, or null with none. */
export function railSpeedPercent(level: number | null, rules: RailRules | null): number | null {
  if (!rules || level === null || level < 1) return null;
  return rules.levels[Math.min(level, rules.levels.length) - 1]?.speedPercent ?? null;
}

/** What laying (level 1) or raising a rail to `level` costs; null past the top. */
export function railCost(level: number, rules: RailRules) {
  if (level < 1) return null;
  return rules.levels[level - 1]?.cost ?? null;
}

/** A standing Rail Depot (`buildings` kind `depot`): where, whose, and its level. */
export interface DepotSpot extends Hex {
  readonly ownerUserId: string;
  readonly level: number;
}

/** No run limit on a rail line: it carries as far as it goes. */
const UNLIMITED_RUN = { wire: { cost: {}, maxRun: Number.MAX_SAFE_INTEGER } };

/**
 * Which of the player's rail tiles are rail-joined to one of their Rail
 * Depots (#874, supervisor 61 ruling): a chain of their own rails, each next
 * to the last, from the tile to one on or next to the Depot's tile. The
 * same chain rule as power (`powerReach`, with the Depot as the source and
 * no run limit), so only their rails and Depots on land they hold count.
 * Each tile maps to the highest Depot level it reaches.
 */
export function depotJoined(
  tiles: readonly PowerTile[],
  rails: readonly RailSpot[],
  depots: readonly DepotSpot[],
  userId: string,
): Map<HexKey, number> {
  const joined = new Map<HexKey, number>();
  for (const depot of depots) {
    if (depot.ownerUserId !== userId) continue;
    for (const key of powerReach(tiles, rails, [depot], userId, UNLIMITED_RUN).keys()) {
      joined.set(key, Math.max(joined.get(key) ?? 0, depot.level));
    }
  }
  return joined;
}
