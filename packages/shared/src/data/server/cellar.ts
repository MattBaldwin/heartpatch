import type { CellarRules } from '../../schemas/data/cellar.js';

/** The key hunt and the hidden cellar (#306 PR 2c). Secret (CLAUDE.md rule 6). */
export const CELLAR_RULES: CellarRules = {
  keyFromVillage: { min: 2, max: 4 }, // TUNE: moved here from `MAP_GEN.communities`
  rareFindMultiplier: 2, // TUNE: the issue's "hidden cellars about 2×"
  keyMoveRange: 4, // TUNE: steps from the key's tile now (matches how far keys hide from villages)
  // The big chest (#306, owner decision of 2026-10-22).
  bigChest: {
    afterSmall: true, // owner decision of 2026-10-22: the small chests first
    items: {
      heartdust: 10, // TUNE: a big pile (owner decision of 2026-10-22); a restore piece costs 1
      glimmer: 25, // TUNE: a cave search finds about 1
    },
    keepsakes: {
      'lantern-tower': 'lamplighters-crown',
      workshop: 'gearheart-wrench',
      'old-well': 'wishing-well-cape',
      bakery: 'golden-baker-jacket',
      watchtower: 'lookout-boots',
    },
  },
};
