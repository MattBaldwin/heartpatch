import type { HollowRules } from '../schemas/data/hollow.js';

/**
 * The Hollow Man's public rules (design doc §14 [DEFAULT]s, decision C).
 * Checked by `checkHollowRules` in tests; the server enforces every one.
 */
export const HOLLOW_RULES: HollowRules = {
  morningMinute: 6 * 60, // TUNE: the map's lights come back up at 6:00 AM map time
  reportNights: 3, // TUNE: the morning report covers the last 3 nights
  graceNights: 2, // TUNE: owner decision 2026-10-03 (someone joining at 6:55 PM keeps their squishy)
  // He grows bolder night by night on a Keeper's dark land (#277, owner
  // decisions 2026-10-08). Nights 1–2 are the grace above.
  strength: {
    nights: [
      { from: 1, stage: 'watching', chances: [] },
      { from: 3, stage: 'curious', chances: [25] }, // TUNE:
      { from: 4, stage: 'curious', chances: [50] }, // TUNE:
      { from: 5, stage: 'curious', chances: [75] }, // TUNE:
      { from: 6, stage: 'curious', chances: [100] }, // TUNE:
      { from: 7, stage: 'bold', chances: [100, 15] }, // TUNE:
      { from: 8, stage: 'bold', chances: [100, 27] }, // TUNE:
      { from: 9, stage: 'bold', chances: [100, 40] }, // TUNE:
      { from: 10, stage: 'bold', chances: [100, 52] }, // TUNE:
      { from: 11, stage: 'bold', chances: [100, 65] }, // TUNE:
      { from: 12, stage: 'bold', chances: [100, 77] }, // TUNE:
      { from: 13, stage: 'bold', chances: [100, 90] }, // TUNE:
      { from: 14, stage: 'boldest', chances: [100, 100, 50] }, // TUNE: owner decision 2026-10-08 (Q3)
    ],
    cap: 3, // owner decision 2026-10-08: "up to 3 of each"
    gentleCap: 1, // owner decision 2026-10-08: gentle patches, 1 tile and 1 squishy for good
    landLostPerNight: 3, // TUNE: owner decision 2026-10-08 (Q6), shared with untended land (#194)
    nodesBlockFires: true, // #242 flips this once a node can be cleared
  },
  show: { prowlMinutes: 30 }, // TUNE: owner decision 2026-10-08: he strikes at 7:30 PM
  rescue: {
    heartdust: 1, // TUNE: guess
    rewardsPerDay: 1, // TUNE: design doc §14 [DEFAULT: 1 rescue reward per player per day]
  },
};
