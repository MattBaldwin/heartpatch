import { spentOn } from '../home/costs.js';
import type { Building } from '../schemas/data/buildings.js';
import type { WeatherRules } from '../schemas/data/weather.js';
import type { ItemCounts } from '../gathering/index.js';

// Storm knocks on a Wild Isle (#621, plan §4 "Storm knocks"): nothing is
// destroyed and no squishy is touched. A storm only knocks a building that
// works for its keep about, and it stops until it's fixed. Whether a front
// knocks one is a seeded roll the server makes (rule 6); these are the
// public parts the client explains with.

/**
 * The kinds a storm can knock about: the ones that make things and pay a
 * morning upkeep (a knocked one stops working and owes nothing). Never a
 * fire, a habitat, Training Grounds, a fence, a road or the house (plan §0).
 */
export const KNOCKABLE_KINDS: readonly Building['kind'][] = ['resource', 'warehouse', 'works'];

/** Can a storm knock this building about? Not a weatherproof one (the Greenhouse, owner answer Q4). */
export function canBeKnocked(building: Building): boolean {
  return KNOCKABLE_KINDS.includes(building.kind) && building.weatherproof !== true;
}

/**
 * What fixing a knocked building costs: `repairPercent` of everything spent
 * on it up to its level, rounded up per item, so any fix costs something.
 */
export function repairCost(
  building: Building,
  level: number,
  rules: Pick<WeatherRules['effects'], 'repairPercent'>,
): ItemCounts {
  const cost: ItemCounts = {};
  for (const [id, n] of Object.entries(spentOn(building, level))) {
    if (n > 0) cost[id] = Math.ceil((n * rules.repairPercent) / 100);
  }
  return cost;
}
