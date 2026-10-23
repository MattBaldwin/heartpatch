import type { FarHollowSecrets } from '../../schemas/data/far-hollow.js';

/** The far Hollow (#306 PR 6, plan Q7). Secret (CLAUDE.md rule 6). */
export const FAR_HOLLOW_SECRETS: FarHollowSecrets = {
  heartdustFindMultiplier: 4, // TUNE: plan Q7, Heartdust at 4× ordinary
  // The explore pages, the gentlest first: the season's page is the first one still missing.
  lorePages: [
    'under-a-mossy-rock',
    'the-humming-reeds',
    'chalk-on-the-cave-wall',
    'a-pressed-juniper-sprig',
    'the-door-in-the-gap',
  ],
  completionGift: { heartdust: 3, treats: 5 }, // TUNE: a little more than a cellar's small chest
};
