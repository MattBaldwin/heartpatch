import type { HollowRules } from '../schemas/data/hollow.js';

/**
 * The Hollow Man's public rules (design doc §14 [DEFAULT]s, decision C).
 * Checked by `checkHollowRules` in tests; the server enforces every one.
 */
export const HOLLOW_RULES: HollowRules = {
  morningMinute: 6 * 60, // TUNE: the map's lights come back up at 6:00 AM map time
  reportNights: 3, // TUNE: the morning report covers the last 3 nights
  graceNights: 2, // TUNE: owner decision 2026-10-03 (someone joining at 8:55 PM keeps their squishy)
  rescue: {
    heartdust: 1, // TUNE: guess
    rewardsPerDay: 1, // TUNE: design doc §14 [DEFAULT: 1 rescue reward per player per day]
  },
};
