import type { SpawnTable } from '../../schemas/data/spawn-tables.js';

/**
 * Wild squishy spawn tables. Secret (CLAUDE.md rule 6): server-only. A table
 * matches a tile's terrain, and its season and time of day when it names one
 * (`resolveWildSpawn`); a seasonal species only spawns in its own season too.
 * The launch roster (#10) adds its rows here; no engine change needed.
 */
export const SPAWN_TABLES: SpawnTable[] = [
  // TUNE: placeholder until #10's roster; Moonpuff is the only wild species yet.
  {
    id: 'placeholder-wanderers',
    terrains: [
      'meadow',
      'forest',
      'old-forest',
      'hills',
      'mountains',
      'lake',
      'pumpkin-fields',
      'junipers-gap',
    ],
    entries: [{ species: 'placeholder-moonpuff', weight: 1 }],
  },
  // TUNE: placeholder; Halloween nights in the pumpkins draw Moonpuffs out.
  {
    id: 'placeholder-halloween-nights',
    terrains: ['pumpkin-fields', 'old-forest'],
    season: 'halloween',
    timeOfDay: 'night',
    entries: [{ species: 'placeholder-moonpuff', weight: 3 }],
  },
];
