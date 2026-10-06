import type { CareRules, GrowthRules } from '../schemas/data/care.js';

/** Care and contentment (design doc §7, DECISIONS G). Checked by `checkCareRules` in tests. */
export const CARE_RULES: CareRules = {
  maxContentment: 100,
  baselineContentment: 0, // TUNE: neglect only means no bonus (design doc §7)
  startContentment: 50, // TUNE: a new squishy starts half content (owner, 2026-10-03)
  hoursFullToBaseline: 24, // TUNE: design doc §7 [DEFAULT: ~24h from full to baseline]
  fullActionsPerDay: 3, // TUNE: design doc §7 [DEFAULT: 3]
  // TUNE: the 4th action that day gives half, the 5th a quarter, then a little.
  falloffPercents: [50, 25, 10],
  coinsPerFullAction: 1, // TUNE: Patch Coins per full care action (#45)
  dailyCoinCap: 10, // TUNE: design doc §7 [DEFAULT], per account per day
  // TUNE: the soft words for contentment (style guide §2: no numbers in the main UI).
  moods: [
    { id: 'glowing', atLeast: 75, line: 'Glowing with happiness!' },
    { id: 'happy', atLeast: 40, line: 'Happy and bouncy!' },
    { id: 'calm', atLeast: 10, line: 'Calm and content.' },
    { id: 'cuddly', atLeast: 0, line: 'Could use a cuddle!' },
  ],
};

/** Levels, XP and the care × habitat multiplier (design doc §7–8). Checked by `checkGrowthRules`. */
export const GROWTH_RULES: GrowthRules = {
  maxLevel: 100, // TUNE:
  // TUNE: owner decision 2026-10-06 (design review Q1): keep level 100, but
  // make 30–100 a long tail. `pnpm sim:progression`: a casual kid's Partner
  // grows up (16) on day 3–5, is about 23 on day 14 and 29 on day 30; an
  // engaged kid's is about 60 on day 30. Knee 16 is when starters grow up;
  // knee 30 starts the long tail. Pinned by `growth-pace.test.ts`.
  xpCurve: {
    perLevel: 20,
    curve: 20,
    knees: [
      { level: 16, steep: 500 },
      { level: 30, steep: 1500 },
    ],
  },
  care: { minPercent: 100, maxPercent: 175 }, // TUNE: design doc §7 [DEFAULT: 1.0× to 1.75×]
  habitat: { onePercent: 135, bothPercent: 175 }, // TUNE: design doc §7 [DEFAULT: up to 1.75×]
  capPercent: 300, // TUNE: design doc §7 [DEFAULT: 3×]
};
