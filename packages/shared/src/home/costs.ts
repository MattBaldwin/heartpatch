import type { Building } from '../schemas/data/buildings.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';
import type { ItemCounts } from '../gathering/index.js';

// What buildings cost and give back (design doc §13). Pure, so the client
// shows exactly what the server charges.

/** What putting a building up costs: its level-1 cost. */
export function buildCost(building: Building): ItemCounts {
  return { ...(building.levels[0]?.cost ?? {}) };
}

/**
 * What raising a building from `level` to the next level costs, or null at
 * its top level (design doc §13: upgrades raise radius or capacity).
 */
export function upgradeCost(building: Building, level: number): ItemCounts | null {
  const next = building.levels[level];
  return level >= 1 && next ? { ...next.cost } : null;
}

/** Everything spent on a building to reach `level` (level 1 is the build cost). */
export function spentOn(building: Building, level: number): ItemCounts {
  const spent: ItemCounts = {};
  for (const step of building.levels.slice(0, level)) {
    for (const [id, n] of Object.entries(step.cost)) spent[id] = (spent[id] ?? 0) + n;
  }
  return spent;
}

/**
 * What taking a building down gives back: its refund percent of everything
 * spent on it, rounded down per item. Items that round to 0 are left out.
 */
export function removeRefund(
  building: Building,
  level: number,
  rules: Pick<HomeBaseRules, 'removeRefundPercent'>,
): ItemCounts {
  const percent = building.refundPercent ?? rules.removeRefundPercent;
  const refund: ItemCounts = {};
  for (const [id, n] of Object.entries(spentOn(building, level))) {
    const back = Math.floor((n * percent) / 100);
    if (back > 0) refund[id] = back;
  }
  return refund;
}

/** The fuel `nights` more nights take. */
export function fuelCost(
  fire: { fuelResource: string; fuelPerNight: number },
  nights: number,
): ItemCounts {
  return { [fire.fuelResource]: fire.fuelPerNight * nights };
}
