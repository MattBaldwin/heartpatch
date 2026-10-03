import type { SpawnTable } from '../../schemas/data/spawn-tables.js';

/**
 * Wild squishy spawn tables. Secret (CLAUDE.md rule 6): server-only. A table
 * matches a tile's terrain, and its season and time of day when it names one
 * (`resolveWildSpawn`); a seasonal species only spawns in its own season too.
 * Content only: new rows need no engine change.
 *
 * Launch roster (#10): every terrain has an everyday table, so there's
 * always someone to find; times of day and Halloween add more on top. Only
 * base forms spawn wild (evolved forms are met as guardians in the Gap).
 * Weights are relative within the tables that match a tile.
 */
export const SPAWN_TABLES: SpawnTable[] = [
  // Everyday tables: any season, any time of day. TUNE: every weight.
  {
    id: 'meadow',
    terrains: ['meadow'],
    entries: [
      { species: 'fuzzbolt', weight: 6 },
      { species: 'emberbun', weight: 5 },
      { species: 'puddlepuff', weight: 4 },
      { species: 'fizzlepop', weight: 4 },
      { species: 'thistlepip', weight: 3 },
    ],
  },
  {
    id: 'forest',
    terrains: ['forest'],
    entries: [
      { species: 'thistlepip', weight: 5 },
      { species: 'nookling', weight: 3 },
      { species: 'emberbun', weight: 3 },
      { species: 'fuzzbolt', weight: 2 },
      { species: 'mossmuffin', weight: 2 },
    ],
  },
  {
    id: 'old-forest',
    terrains: ['old-forest'],
    entries: [
      { species: 'nookling', weight: 5 },
      { species: 'pebblesnooze', weight: 3 },
      { species: 'mossmuffin', weight: 3 },
      { species: 'snoozicle', weight: 2 },
    ],
  },
  {
    id: 'hills',
    terrains: ['hills'],
    entries: [
      { species: 'pebblesnooze', weight: 6 },
      { species: 'fuzzbolt', weight: 4 },
      { species: 'emberbun', weight: 3 },
      { species: 'fizzlepop', weight: 2 },
      { species: 'glimmerock', weight: 2 },
    ],
  },
  {
    id: 'mountains',
    terrains: ['mountains'],
    entries: [
      { species: 'snoozicle', weight: 5 },
      { species: 'pebblesnooze', weight: 4 },
      { species: 'flurrypup', weight: 3 },
      { species: 'glimmerock', weight: 3 },
    ],
  },
  {
    id: 'lake',
    terrains: ['lake'],
    entries: [
      { species: 'puddlepuff', weight: 7 },
      { species: 'bubbletub', weight: 5 },
      { species: 'snoozicle', weight: 2 },
    ],
  },
  {
    // Outside Halloween the pumpkin patch is a sunny field like any other.
    id: 'pumpkin-fields',
    terrains: ['pumpkin-fields'],
    entries: [
      { species: 'emberbun', weight: 4 },
      { species: 'thistlepip', weight: 3 },
      { species: 'fizzlepop', weight: 3 },
    ],
  },
  {
    // The richest land: a bit of everyone, and the only place Thunderpuff roams.
    id: 'junipers-gap',
    terrains: ['junipers-gap'],
    entries: [
      { species: 'puddlepuff', weight: 2 },
      { species: 'pebblesnooze', weight: 2 },
      { species: 'emberbun', weight: 2 },
      { species: 'snoozicle', weight: 2 },
      { species: 'fuzzbolt', weight: 2 },
      { species: 'fizzlepop', weight: 2 },
      { species: 'bubbletub', weight: 2 },
      { species: 'thistlepip', weight: 2 },
      { species: 'nookling', weight: 2 },
      { species: 'flurrypup', weight: 2 },
      { species: 'glimmerock', weight: 2 },
      { species: 'mossmuffin', weight: 2 },
      { species: 'dawndrop', weight: 1 },
      { species: 'thunderpuff', weight: 1 },
    ],
  },

  // Times of day.
  {
    // Dawndrop hums good morning on sunny open land.
    id: 'sunny-days',
    terrains: ['meadow', 'hills'],
    timeOfDay: 'day',
    entries: [{ species: 'dawndrop', weight: 1 }], // TUNE: an epic find
  },
  {
    id: 'quiet-nights',
    terrains: ['meadow', 'forest', 'old-forest'],
    timeOfDay: 'night',
    entries: [
      { species: 'nookling', weight: 3 }, // TUNE:
      { species: 'snoozicle', weight: 2 }, // TUNE:
    ],
  },

  // Halloween (each species also carries `season: 'halloween'`).
  {
    // Gourdon hides among the Pumpkins you gather.
    id: 'halloween-pumpkins',
    terrains: ['pumpkin-fields'],
    season: 'halloween',
    entries: [
      { species: 'gourdon', weight: 12 }, // TUNE:
      { species: 'candlekit', weight: 3 }, // TUNE:
    ],
  },
  {
    id: 'halloween-strays',
    terrains: ['meadow', 'forest', 'hills', 'junipers-gap'],
    season: 'halloween',
    entries: [{ species: 'gourdon', weight: 2 }], // TUNE:
  },
  {
    // Upsybats love Witch Dust: dusk where it's gathered (Pumpkins, Emberwood).
    // Spawns can't see what players gather yet; terrain stands in for it.
    id: 'halloween-dusk',
    terrains: ['old-forest', 'pumpkin-fields'],
    season: 'halloween',
    timeOfDay: 'dusk',
    entries: [
      { species: 'upsybat', weight: 8 }, // TUNE:
      { species: 'candlekit', weight: 4 }, // TUNE:
    ],
  },
  {
    // Glowboo only comes out at night, glowing, just in case.
    id: 'halloween-nights',
    terrains: ['forest', 'old-forest', 'pumpkin-fields', 'junipers-gap'],
    season: 'halloween',
    timeOfDay: 'night',
    entries: [
      { species: 'upsybat', weight: 4 }, // TUNE:
      { species: 'glowboo', weight: 3 }, // TUNE:
      { species: 'candlekit', weight: 2 }, // TUNE:
    ],
  },
  {
    // Secret: a tiny piece of the Heartpatch, out on Gap nights. Weights add
    // up across matching tables, so this is 1 in 27 Gap night spawns (1 in
    // 38 at Halloween): about one Heartlet in the Gap every 5–6 days.
    id: 'gap-nights',
    terrains: ['junipers-gap'],
    timeOfDay: 'night',
    entries: [{ species: 'heartlet', weight: 1 }], // TUNE:
  },
];
