import type { TerritoryRules } from '../schemas/data/territory.js';

/**
 * Raid rules (design doc §11 [DEFAULT]s, decision B). Checked by
 * `checkTerritoryRules` in tests; the server enforces every one of them.
 */
export const TERRITORY_RULES: TerritoryRules = {
  cooldownHours: 4, // TUNE: design doc §11 [DEFAULT: 4 h]
  newPlayerShieldHours: 48, // TUNE: design doc §11 [DEFAULT: 48 h]
  attemptsPerDay: 5, // TUNE: owner decision 2026-10-06 (design review Q2), was 10
  abandonMinutes: 10, // TUNE: design doc §11 [DEFAULT: 10 minutes]
  maxDefenders: 3, // TUNE: issue #15 (up to 3 per tile)
  dailyLossCap: { on: 3, gentle: 1 }, // TUNE: design doc §11 [DEFAULT: 3 / 1]
  gentle: { smallerBelowPercent: 50, rewardPercent: 50 }, // TUNE: design doc §11 [DEFAULT: half, 50%]
  // Land that misses you (owner decision 2026-10-06, design review Q2;
  // `pnpm sim:map-fill` models these).
  tending: {
    missesYouAfterDays: 4, // TUNE: sim; a kid who plays twice a week never sees land go
    wildAfterDays: 12, // TUNE: sim; a week away never loses land, even just before the warning
    wildPerNight: { off: 3, on: 3, gentle: 2 }, // TUNE: sim, see the map-fill report
    keepRadius: 2, // TUNE: guess; the home ring plus the ring right outside it
  },
};
