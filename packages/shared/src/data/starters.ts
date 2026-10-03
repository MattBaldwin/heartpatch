import type { StarterData } from '../schemas/data/starters.js';

/**
 * The three starters a player picks from on joining a patch (owner decision
 * 2026-10-03): Fire, Water and Leaf, which go round in a circle on the
 * element matrix (Fire warms Leaf, Leaf drinks Water, Water soaks Fire), so
 * no pick is the best one. All three are year-round base forms that grow up
 * at level 16 to 18. Shown in this order.
 */
export const STARTERS: StarterData = {
  speciesIds: ['emberbun', 'puddlepuff', 'thistlepip'],
};

/** True if `speciesId` is one of the starters. */
export function isStarterSpecies(speciesId: string): boolean {
  return STARTERS.speciesIds.includes(speciesId);
}
