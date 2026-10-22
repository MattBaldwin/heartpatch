import { inSeason, type ItemCounts } from '../gathering/index.js';
import type { ClearingRules } from '../schemas/data/clearing.js';
import type { JobRules } from '../schemas/data/jobs.js';
import { isAvailableRecipe, type Recipe } from '../schemas/data/recipes.js';
import type { Resource } from '../schemas/data/resources.js';

// Clearing land (#242). Pure: the server fixes a clear's drop when it starts,
// like a gather's yield (#17), so clearing a little late never changes it.

/** A tile as a clear sees it. */
export interface ClearTile {
  readonly terrain: string;
  readonly nodeResource: string | null;
}

/**
 * What clearing a tile drops: one gather of its spot when it has one (its
 * plain quantity, no seasonal extras), else `landDropCycles` cycles of the
 * land's own yield. Empty when there's nothing to drop. With `seasons`
 * (the seasons on as the clear starts), a seasonal resource out of its
 * season drops nothing, as it can't be gathered then (#601: Pumpkin Fields
 * clear after Halloween too).
 */
export function clearDrop(
  tile: ClearTile,
  resources: readonly Pick<Resource, 'id' | 'gather' | 'season'>[],
  jobRules: Pick<JobRules, 'terrainYields'>,
  rules: Pick<ClearingRules, 'landDropCycles'>,
  seasons?: ReadonlySet<string>,
): ItemCounts {
  const dormant = (id: string) => {
    const resource = resources.find((r) => r.id === id);
    return seasons !== undefined && resource !== undefined && !inSeason(resource, seasons);
  };
  if (tile.nodeResource !== null) {
    const quantity = resources.find((r) => r.id === tile.nodeResource)?.gather?.quantity ?? 0;
    return quantity > 0 && !dormant(tile.nodeResource) ? { [tile.nodeResource]: quantity } : {};
  }
  const land = jobRules.terrainYields.find((y) => y.terrain === tile.terrain);
  const quantity = (land?.quantity ?? 0) * rules.landDropCycles;
  return land && quantity > 0 && !dormant(land.resource) ? { [land.resource]: quantity } : {};
}

/**
 * Can a kid make this clearing tool yet? True when a recipe that's in the
 * game (`isAvailableRecipe`) makes it. While the tools' recipes are hidden,
 * no land can be cleared, so nothing should count on it (the Hollow Man's
 * fire sites, #242).
 */
export function clearToolMakeable(
  toolId: string,
  recipes: readonly Pick<Recipe, 'output' | 'hidden'>[],
): boolean {
  return recipes.some((r) => r.output.resource === toolId && isAvailableRecipe(r));
}
