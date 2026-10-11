import type { ItemCounts } from '../gathering/index.js';
import type { ClearingRules } from '../schemas/data/clearing.js';
import type { JobRules } from '../schemas/data/jobs.js';
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
 * land's own yield. Empty when there's nothing to drop.
 */
export function clearDrop(
  tile: ClearTile,
  resources: readonly Pick<Resource, 'id' | 'gather'>[],
  jobRules: Pick<JobRules, 'terrainYields'>,
  rules: Pick<ClearingRules, 'landDropCycles'>,
): ItemCounts {
  if (tile.nodeResource !== null) {
    const quantity = resources.find((r) => r.id === tile.nodeResource)?.gather?.quantity ?? 0;
    return quantity > 0 ? { [tile.nodeResource]: quantity } : {};
  }
  const land = jobRules.terrainYields.find((y) => y.terrain === tile.terrain);
  const quantity = (land?.quantity ?? 0) * rules.landDropCycles;
  return land && quantity > 0 ? { [land.resource]: quantity } : {};
}
