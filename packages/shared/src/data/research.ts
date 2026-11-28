import type { ResearchRules } from '../schemas/data/research.js';

/**
 * The Clockwork Isle research tree (#874). Wave 1 ships tier 1; tier 2
 * lands with Wave 2's buildings. Cozy and Wild patches never read it
 * (`patchRules(type).research` is null). Checked by `checkResearchTree`.
 *
 * Blueprint economy (owner ruling 2026-11-28): tier 1 grants 8 Blueprints
 * in all, once (a known node can't be researched again, so it can't be
 * farmed), which buys one of each Clockwork building plus the level-2
 * upgrades. Blueprints stay sellable and tradable. Pinned in
 * `research/research.test.ts`.
 */
export const RESEARCH_TREE: ResearchRules = {
  oneAtATime: true,
  nodes: [
    {
      id: 'sorting',
      tier: 1,
      name: 'Sorting',
      description: 'Teach a machine to sort Greens into Treats. Unlocks the Sorter.',
      cost: { parts: 6, spark: 4 }, // TUNE:
      seconds: 2 * 3600, // TUNE:
      requires: [],
      grants: { blueprints: 3 }, // TUNE: Sorter L1 + L2
    },
    {
      id: 'bright-bulbs',
      tier: 1,
      name: 'Bright Bulbs',
      description: 'A bulb that glows all night long. Unlocks the Clockwork Beacon.',
      cost: { parts: 8, spark: 6 }, // TUNE:
      seconds: 3 * 3600, // TUNE:
      requires: [],
      grants: { blueprints: 2 }, // TUNE: the Beacon
    },
    {
      id: 'tidy-rails',
      tier: 1,
      name: 'Tidy Rails',
      description: 'Straighter, speedier rails. Unlocks Tidy Rails and a bigger Depot.',
      cost: { parts: 6, spark: 2 }, // TUNE:
      seconds: 2 * 3600, // TUNE:
      requires: [],
      grants: { blueprints: 2 }, // TUNE: Depot L2 + Bench L2
    },
    {
      // The presents tie-in (plan R1.1, owner yes 2026-11-28): unlocks the Gift Wrapper.
      id: 'wrapping',
      tier: 1,
      name: 'Wrapping',
      description: 'Paper, ribbon and a clever fold. Unlocks the Gift Wrapper.',
      cost: { parts: 6, spark: 4 }, // TUNE:
      seconds: 2 * 3600, // TUNE:
      requires: [],
      grants: { blueprints: 1 }, // TUNE: the Gift Wrapper
    },
  ],
};
