import type { ResearchRules } from '../schemas/data/research.js';

/**
 * The Clockwork Isle research tree (#874). Wave 1 ships tier 1; tier 2
 * lands with Wave 2's buildings. Cozy and Wild patches never read it
 * (`patchRules(type).research` is null). Checked by `checkResearchTree`.
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
      grants: { blueprints: 2 }, // TUNE:
    },
    {
      id: 'bright-bulbs',
      tier: 1,
      name: 'Bright Bulbs',
      description: 'A bulb that glows all night on Spark. Unlocks the Clockwork Beacon.',
      cost: { parts: 8, spark: 6 }, // TUNE:
      seconds: 3 * 3600, // TUNE:
      requires: [],
      grants: { blueprints: 2 }, // TUNE:
    },
    {
      id: 'tidy-rails',
      tier: 1,
      name: 'Tidy Rails',
      description: 'Straighter, speedier rails. Unlocks Tidy Rails and a bigger Depot.',
      cost: { parts: 6, spark: 2 }, // TUNE:
      seconds: 2 * 3600, // TUNE:
      requires: [],
      grants: { blueprints: 1 }, // TUNE:
    },
  ],
};
