import type { SpawnRules } from '../../schemas/data/spawn-rules.js';

/** How wild spawns work (tech spec §8). Secret (CLAUDE.md rule 6): server-only. */
export const SPAWN_RULES: SpawnRules = {
  windowHours: 4, // TUNE: tech spec §8 [DEFAULT: 4 h]
  chance: 35, // TUNE: about a third of tiles have someone to find each window
  levels: { min: 2, max: 6 }, // TUNE: a fair fight for a squishy that's just starting out
  // TUNE: owner decision 2026-10-06 (design review Q2): wild squishies are
  // the Partner's level −2 to +1, so fights stay a fair match as it grows.
  partnerOffset: { min: -2, max: 1 },
  // TUNE: judged at each window's middle, so 4-hour windows give night, day,
  // day, day, dusk, night.
  timesOfDay: [
    { from: 0, timeOfDay: 'night' },
    { from: 6, timeOfDay: 'day' },
    { from: 17, timeOfDay: 'dusk' },
    { from: 20, timeOfDay: 'night' },
  ],
};
