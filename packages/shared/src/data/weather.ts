import type { WeatherRules } from '../schemas/data/weather.js';

/**
 * Wild Isle weather (#621): what kind of day it is and how its fronts move.
 * Cozy Patches have no weather (`patchRules('cozy').weather` is null). Each
 * day's plan is stored once (`weather_days`), so a retune never rewrites a
 * day kids already saw. Checked by `checkWeatherRules`.
 */
export const WEATHER_RULES: WeatherRules = {
  days: [
    { kind: 'clear', weight: 50 }, // TUNE:
    { kind: 'rain', weight: 25 }, // TUNE:
    { kind: 'fog', weight: 10 }, // TUNE:
    { kind: 'storm', weight: 10 }, // TUNE:
    { kind: 'drought', weight: 5 }, // TUNE:
  ],
  seasons: [
    {
      // Spooky season: more fog, a few more storms.
      season: 'halloween',
      days: [
        { kind: 'clear', weight: 40 }, // TUNE:
        { kind: 'rain', weight: 20 }, // TUNE:
        { kind: 'fog', weight: 25 }, // TUNE:
        { kind: 'storm', weight: 15 }, // TUNE:
      ],
    },
  ],
  fronts: {
    perDay: { min: 0, max: 2 }, // TUNE:
    tilesPerHour: { min: 2, max: 4 }, // TUNE:
    radius: { min: 2, max: 3 }, // TUNE:
  },
  effects: {
    gatherPercent: { fog: 80 }, // TUNE:
    pierPercent: { fog: 150 }, // TUNE: fish bite in the fog
    storm: {
      knockPercent: 35, // TUNE:
      floodBonusPercent: 15, // TUNE:
      nearWater: ['deep', 'river'],
    },
    repairPercent: 25, // TUNE:
  },
  forecast: { summaryForAll: true, detailNeedsVane: true },
  retentionDays: 14, // TUNE:
};
