import type { CellarRules } from '../../schemas/data/cellar.js';

/** The key hunt and the hidden cellar (#306 PR 2c). Secret (CLAUDE.md rule 6). */
export const CELLAR_RULES: CellarRules = {
  keyFromVillage: { min: 2, max: 4 }, // TUNE: moved here from `MAP_GEN.communities`
  rareFindMultiplier: 2, // TUNE: the issue's "hidden cellars about 2×"
  keyMoveRange: 4, // TUNE: steps from the key's tile now (matches how far keys hide from villages)
};
