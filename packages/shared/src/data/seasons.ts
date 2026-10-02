import type { Season } from '../schemas/data/seasons.js';

/**
 * Season windows (design doc §15), in the map's time zone, inclusive.
 * Overrides are keyed by the year the window starts in.
 */
export const SEASONS: Season[] = [
  {
    id: 'halloween',
    name: 'Halloween',
    description: 'Pumpkins glow, Witch Dust sparkles and spooky squishies come out to play.',
    window: { start: '10-01', end: '11-02' }, // TUNE:
    // TUNE: extended for the 2026 launch (docs/DECISIONS.md).
    overrides: { '2026': { start: '10-01', end: '11-09' } },
  },
  {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    description: 'Crunchy leaves, cozy feasts and plenty to share.',
    window: { start: '11-03', end: '11-30' }, // TUNE:
  },
  {
    id: 'christmas',
    name: 'Christmas',
    description: 'Snowy days, frosty squishies and presents to unwrap.',
    window: { start: '12-01', end: '12-31' }, // TUNE:
  },
  {
    id: 'new-year',
    name: 'New Year',
    description: 'Fireworks, countdowns and a brand-new year of fun.',
    window: { start: '12-31', end: '01-02' }, // TUNE:
  },
];
