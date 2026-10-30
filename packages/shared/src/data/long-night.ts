import type { LongNightRules } from '../schemas/data/long-night.js';

/**
 * The Long Night's public rules (#727, plan on the issue, owner answers
 * 2026-10-30). Checked by `checkLongNightRules` in tests; the server
 * enforces every one.
 */
export const LONG_NIGHT_RULES: LongNightRules = {
  defaultWeekday: 6, // TUNE: owner decision Q5 (Saturday); also `maps.long_night_weekday`'s default
  gapOpenHours: 24, // TUNE: Juniper's Gap is open a day from the strike
  rescueRewardsMultiplier: 2, // TUNE: double Heartdust rescues while the Gap is open
  awayAfterDays: 14, // TUNE: away this long and the patch's hold doesn't count you
  noticeDays: 3, // TUNE: "Long Night in 3 days"
};
