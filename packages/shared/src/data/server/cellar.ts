import type { CellarRules } from '../../schemas/data/cellar.js';

/** The key hunt and the hidden cellar (#306 PR 2c). Secret (CLAUDE.md rule 6). */
export const CELLAR_RULES: CellarRules = {
  keyFromVillage: { min: 2, max: 4 }, // TUNE: moved here from `MAP_GEN.communities`
  rareFindMultiplier: 2, // TUNE: the issue's "hidden cellars about 2×"
  // The big chest (#306, owner decision of 2026-10-22).
  bigChest: {
    afterSmall: true, // TUNE: owner to pick on the screens (true: the small chests first)
    items: {
      heartdust: 5, // TUNE: a big pile; a restore piece costs 1
      glimmer: 12, // TUNE: a cave search finds about 1
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
