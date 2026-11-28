import type { RailRules } from '../schemas/data/rails.js';

/**
 * Clockwork Isle rails (#874): lines like roads, with a Rail Depot to haul
 * home. Cozy and Wild patches never read these (`patchRules(type).rails` is
 * null). Checked by `checkRailRules`.
 */
export const RAIL_RULES: RailRules = {
  levels: [
    { cost: { timber: 2, parts: 1 }, reach: 2, speedPercent: 125 }, // TUNE: Rail
    // TUNE: Tidy rail
    {
      cost: { timber: 4, stone: 2, parts: 2 },
      reach: 3,
      speedPercent: 150,
      requiresResearch: 'tidy-rails',
    },
  ],
};
