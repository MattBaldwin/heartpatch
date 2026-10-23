import type { FarHollowSecrets } from '../../schemas/data/far-hollow.js';

/** The far Hollow (#306 PR 6, plan Q7). Secret (CLAUDE.md rule 6). */
export const FAR_HOLLOW_SECRETS: FarHollowSecrets = {
  heartdustFindMultiplier: 4, // TUNE: plan Q7, Heartdust at 4× ordinary
  // The season's page is the first one still missing: Halloween 2026's house first,
  // then the explore pages, the gentlest first.
  lorePages: [
    'the-crooked-house',
    'under-a-mossy-rock',
    'the-humming-reeds',
    'chalk-on-the-cave-wall',
    'a-pressed-juniper-sprig',
    'the-door-in-the-gap',
  ],
  completionGift: { heartdust: 3, treats: 5 }, // TUNE: a little more than a cellar's small chest
};
