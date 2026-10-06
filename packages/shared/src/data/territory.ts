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
};
