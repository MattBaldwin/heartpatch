import type { HeartCoinRules } from '../schemas/data/heart-coins.js';

/**
 * Heart Coins earned by playing on a patch (#601). Checked by
 * `checkHeartCoinRules` in tests. The same shape as `COIN_RULES` and paid
 * alongside Patch Coins, not instead of them; `pnpm sim:patch-economy`
 * (#601 PR 5) sets the numbers against building upkeep.
 */
export const HEART_COIN_RULES: HeartCoinRules = {
  // TUNE: as Patch Coins; a journey (#270) is a gate, not a farm.
  battleWin: { wild: 2, tile: 3, 'rival-tile': 3, rescue: 0, journey: 0, friendly: 0 },
  // TUNE: a new friend or a new tile is worth more than a win.
  capture: { wild: 5, tile: 5 },
  // TUNE: one a full-value care action.
  care: { perFullAction: 1 },
  // TUNE: per player per patch day, on that patch only. Selling is how a
  // kid pays for their buildings (upkeep is a fifth of a day's output
  // sold), so its cap covers an engaged kid's four level-4 buildings and
  // the Warehouse with room to spare: they pay about two thirds of what
  // they can earn (`pnpm sim:patch-economy`; 30 couldn't pay for two, 120
  // left an engaged kid at three quarters).
  dailyCaps: { battle: 20, capture: 15, care: 10, sell: 150 },
};
