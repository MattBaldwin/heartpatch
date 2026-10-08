import type { JourneyRules } from '../schemas/data/journeys.js';

/**
 * Journeys to trading posts (#270; owner decisions 2 and 3 on #30). Checked by
 * `checkJourneyRules` in tests. `pnpm sim:progression` reports win rates by
 * distance for a casual and an engaged kid.
 */
export const JOURNEY_RULES: JourneyRules = {
  baseLevel: 4, // TUNE: #30 contract proposal §4
  levelsPerTile: 2, // TUNE: uncapped (owner decision 3); only GROWTH_RULES.maxLevel clamps it
  teamSize: [
    { fromDistance: 1, size: 1 }, // TUNE:
    { fromDistance: 3, size: 2 }, // TUNE:
    { fromDistance: 6, size: 3 }, // TUNE:
  ],
  windowHours: 4, // TUNE: the same 4-hour window as wild spawns
  visitMinutes: 20, // TUNE: long enough to pick up, trade and shop
  // TUNE: the common and uncommon base forms that aren't seasonal. Rare and
  // rarer base forms are a step harder (owner decision 2026-10-07), which
  // would make a journey's difficulty a lucky draw.
  trail: [
    'puddlepuff',
    'pebblesnooze',
    'emberbun',
    'snoozicle',
    'fuzzbolt',
    'fizzlepop',
    'bubbletub',
    'thistlepip',
    'nookling',
  ],
};
