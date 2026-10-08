import type { Recipe } from '../schemas/data/recipes.js';
import type { Resource } from '../schemas/data/resources.js';
import type { TutorialOverrides } from '../schemas/data/tutorial.js';

// Gathering and crafting rules (design doc §12, §15), shared so the server
// decides and the client explains with the same logic. Pure: the server
// passes in the seasons that are on (`activeSeasons` for the map-local date).

/** Item id → how many. A missing id means none. */
export type ItemCounts = Record<string, number>;

/** Seasonal things only gather in their season; the rest any time. */
export function inSeason(
  thing: Pick<Resource, 'season'> | Pick<Recipe, 'season'>,
  activeSeasonIds: ReadonlySet<string>,
): boolean {
  return thing.season === undefined || activeSeasonIds.has(thing.season);
}

/** Can a node of this resource be gathered right now? */
export function canGather(resource: Resource, activeSeasonIds: ReadonlySet<string>): boolean {
  return resource.gather !== undefined && inSeason(resource, activeSeasonIds);
}

/**
 * What one gather on a node yields: the resource itself, plus any extras
 * whose season is on (Witch Dust only around Halloween). Decided when the
 * gather starts, so it doesn't change while it runs.
 */
export function gatherYield(
  resource: Resource,
  resources: readonly Resource[],
  activeSeasonIds: ReadonlySet<string>,
): ItemCounts {
  const settings = resource.gather;
  if (!settings) return {};
  const items: ItemCounts = { [resource.id]: settings.quantity };
  for (const extra of settings.extras ?? []) {
    const found = resources.find((r) => r.id === extra.resource);
    if (!found || !inSeason(found, activeSeasonIds)) continue;
    items[extra.resource] = (items[extra.resource] ?? 0) + extra.quantity;
  }
  return items;
}

/** How long a gather takes: the resource's time, or the tutorial's quick one. */
export function gatherSeconds(
  resource: Resource,
  overrides: Pick<TutorialOverrides, 'gatherSeconds'> | null,
): number {
  return overrides?.gatherSeconds ?? resource.gather?.seconds ?? 0;
}

/**
 * How long a craft takes (#238): the recipe's time, `fasterWith.percent`
 * less (rounded up) when a squishy of that element is on the player's team
 * as it starts.
 */
export function craftSecondsFor(
  recipe: Pick<Recipe, 'craftSeconds' | 'fasterWith'>,
  teamElements: readonly string[],
): number {
  const faster = recipe.fasterWith;
  if (!faster || !teamElements.includes(faster.element)) return recipe.craftSeconds;
  return Math.ceil((recipe.craftSeconds * (100 - faster.percent)) / 100);
}

/** Ids the player is short of for `cost`, and by how much. Empty = affordable. */
export function shortfall(have: ItemCounts, cost: ItemCounts): ItemCounts {
  const short: ItemCounts = {};
  for (const [id, need] of Object.entries(cost)) {
    const missing = need - (have[id] ?? 0);
    if (missing > 0) short[id] = missing;
  }
  return short;
}

/**
 * The kid-readable line for a shortfall, the same on the server's CONFLICT
 * and the bag's recipe card: "You need 2 more Timber and 1 more Treats first!".
 */
export function needMoreText(short: ItemCounts, resources: readonly Resource[]): string {
  const parts = Object.entries(short).map(
    ([id, n]) => `${String(n)} more ${resources.find((r) => r.id === id)?.name ?? id}`,
  );
  const last = parts.pop() ?? '';
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return `You need ${list} first!`;
}
