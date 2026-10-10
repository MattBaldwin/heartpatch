import type { BoutiqueRules, CoinRules } from '../schemas/data/coins.js';

/**
 * Patch Coins earned in play (design doc §23, issue #45). Checked by
 * `checkCoinRules` in tests. Care pays `CARE_RULES.coinsPerFullAction`, up
 * to `CARE_RULES.dailyCoinCap` a day. A busy day of play earns about 40.
 */
export const COIN_RULES: CoinRules = {
  // TUNE: a win is a few coins; claiming land and Hollow rescues pay in other
  // ways. A journey (#270) is a gate, not a farm: no coins.
  battleWin: { wild: 2, tile: 3, 'rival-tile': 3, rescue: 0, journey: 0, friendly: 0 },
  // TUNE: a new friend or a new tile is worth more than a win.
  capture: { wild: 5, tile: 5 },
  // TUNE: per account per day, across every patch (DECISIONS F).
  dailyCaps: { battle: 20, capture: 15 },
};

/** The Boutique's racks (design doc §23). Prices are on the clothing (`boutiquePrice`). */
export const BOUTIQUE_RULES: BoutiqueRules = {
  dailySlots: 6, // TUNE: design doc §23 [DEFAULT: daily]
  seasonalSlots: 4, // TUNE:
  minPrice: 5, // TUNE:
  maxPrice: 320, // TUNE: the Legendary costume (#261)
};
