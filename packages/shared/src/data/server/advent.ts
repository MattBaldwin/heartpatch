import type { AdventPresents } from '../../schemas/data/advent.js';

/**
 * Advent presents (#37 1c, owner answer 3): 25 presents, December 1–25,
 * one a day per Keeper plus one missed day a day. Secret (CLAUDE.md rule 6):
 * rolled on the server, never sent to the client; the calendar shows only
 * which items a day can hold. Earned only, no money. Christmas clothing
 * joins the pool with the wardrobe lane (2f).
 */
export const ADVENT_PRESENTS: AdventPresents = {
  // Server-only parent of every advent seed (tech spec §8). Changing it
  // rerolls presents not yet opened; opened ones keep their stored result.
  seedSalt: 'heartpatch-advent-2026-snowy-socks',
  daily: {
    picks: 2, // TUNE: two different things a day
    pool: [
      { itemId: 'treats', min: 2, max: 4, weight: 30 }, // TUNE:
      { itemId: 'frosty-treats', min: 1, max: 3, weight: 25 }, // TUNE:
      { itemId: 'pies', min: 1, max: 2, weight: 20 }, // TUNE:
      { itemId: 'cozy-cocoa', min: 1, max: 1, weight: 15 }, // TUNE:
      { itemId: 'glimmer', min: 1, max: 2, weight: 10 }, // TUNE:
      { itemId: 'heartdust', min: 1, max: 1, weight: 5 }, // TUNE: Heartdust is scarce (rescues give 1 a day)
    ],
  },
  fixed: {
    '24': { fireworks: 3 }, // TUNE: owner answer 3, Fireworks fixed on the 24th (for New Year)
    '25': { heartdust: 1 }, // TUNE: a little extra on Christmas Day
  },
  spareOneIn: 3, // TUNE: a wrapped present to pass on about every third day (2e gifts it)
  opening: {
    picks: 2, // TUNE:
    pool: [
      { itemId: 'treats', min: 2, max: 4, weight: 30 }, // TUNE:
      { itemId: 'frosty-treats', min: 1, max: 3, weight: 25 }, // TUNE:
      { itemId: 'pies', min: 1, max: 2, weight: 20 }, // TUNE:
      { itemId: 'cozy-cocoa', min: 1, max: 1, weight: 15 }, // TUNE:
      { itemId: 'glimmer', min: 1, max: 2, weight: 10 }, // TUNE:
    ],
  },
};
