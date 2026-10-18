import type { TrickOrTreatPrizes } from '../../schemas/data/trick-or-treat-prizes.js';

/**
 * Trick-or-treat's treats (#515, the owner-approved plan of 2026-10-18).
 * Secret (CLAUDE.md rule 6): rolled on the server from the map seed, never
 * sent to the client. Heartdust is scarce (a rescue gives 1 a day), so a treat
 * is a little; a lit Jack-o'-Lantern makes costumes likelier and the Heartdust
 * a bit more. Costumes come from the catalog's `trick-or-treat` items.
 */
export const TRICK_OR_TREAT_PRIZES: TrickOrTreatPrizes = {
  trickOneIn: 8, // TUNE: owner answer 2: about 1 visit in 8
  plain: {
    heartdust: { weight: 60, min: 1, max: 1 }, // TUNE:
    squishyCostume: { weight: 25 }, // TUNE:
    keeperCostume: { weight: 15 }, // TUNE:
  },
  lantern: {
    heartdust: { weight: 45, min: 2, max: 2 }, // TUNE:
    squishyCostume: { weight: 30 }, // TUNE:
    keeperCostume: { weight: 25 }, // TUNE:
  },
  // Rarer is rarer, on the #261 ladder's shape. The Mythic Hollow Man costume
  // isn't a treat (it stays found-only), so mythic is 0.
  rarityWeights: {
    common: 30, // TUNE: every weight
    uncommon: 20,
    rare: 12,
    epic: 6,
    legendary: 3,
    mythic: 0,
  },
};
