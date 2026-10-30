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
    terrains: ['meadow', 'clearing'], // #242: cleared land spawns like a meadow
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

  // Wild Isle (#621): the coast, a shore of tide pools. Water kinds that
  // already live by the lake, on the same weights. TUNE: every weight.
  {
    id: 'coast',
    terrains: ['coast'],
    entries: [
      { species: 'puddlepuff', weight: 6 },
      { species: 'bubbletub', weight: 4 },
      { species: 'shellnap', weight: 3 },
      { species: 'quackle', weight: 2 },
    ],
  },

  // Wave 1 (#382): biome-tied kinds, every day of the year, on top of the
  // launch tables above (weights add up across matching tables). Common 4,
  // uncommon 2, rare 1. TUNE: every weight.
  {
    id: 'wave-1-meadow',
    terrains: ['meadow'],
    entries: [
      { species: 'chillypep', weight: 4 },
      { species: 'gnomnom', weight: 2 },
    ],
  },
  {
    id: 'wave-1-forest',
    terrains: ['forest'],
    entries: [
      { species: 'gnomnom', weight: 2 },
      { species: 'moonmoth', weight: 1 },
    ],
  },
  {
    id: 'wave-1-old-forest',
    terrains: ['old-forest'],
    entries: [{ species: 'moonmoth', weight: 1 }],
  },
  {
    id: 'wave-1-hills',
    terrains: ['hills'],
    entries: [
      { species: 'chillypep', weight: 4 },
      { species: 'hailhop', weight: 2 },
      { species: 'gnomnom', weight: 2 },
    ],
  },
  {
    id: 'wave-1-mountains',
    terrains: ['mountains'],
    entries: [
      { species: 'hailhop', weight: 4 },
      { species: 'flakefluff', weight: 4 },
      { species: 'cometsnail', weight: 1 },
      { species: 'moonmoth', weight: 1 },
    ],
  },
  {
    id: 'wave-1-lake',
    terrains: ['lake'],
    entries: [
      { species: 'lilyhop', weight: 4 },
      { species: 'shellnap', weight: 2 },
      { species: 'cometsnail', weight: 1 },
    ],
  },
  {
    id: 'wave-1-pumpkin-fields',
    terrains: ['pumpkin-fields'],
    entries: [
      { species: 'chillypep', weight: 4 },
      { species: 'gnomnom', weight: 2 },
    ],
  },

  // Wave 2 (#382): biome, daylight and night kinds, on top of the tables above.
  // Common 4, uncommon 2, rare 1. TUNE: every weight.
  {
    id: 'wave-2-meadow',
    terrains: ['meadow'],
    entries: [
      { species: 'oinkle', weight: 4 },
      { species: 'dragofruit', weight: 2 },
    ],
  },
  {
    id: 'wave-2-forest',
    terrains: ['forest', 'old-forest'],
    entries: [{ species: 'cubbun', weight: 4 }],
  },
  {
    id: 'wave-2-hills',
    terrains: ['hills'],
    entries: [
      { species: 'spudsy', weight: 4 },
      { species: 'slipwaddle', weight: 2 },
      { species: 'dragofruit', weight: 2 },
    ],
  },
  {
    id: 'wave-2-mountains',
    terrains: ['mountains'],
    entries: [{ species: 'slipwaddle', weight: 4 }],
  },
  {
    id: 'wave-2-pumpkin-fields',
    terrains: ['pumpkin-fields'],
    entries: [
      { species: 'oinkle', weight: 4 },
      { species: 'spudsy', weight: 4 },
    ],
  },
  {
    // Piglets wade in at the water's edge, and ducks bob on the lake.
    id: 'wave-2-lake',
    terrains: ['lake'],
    entries: [
      { species: 'quackle', weight: 4 },
      { species: 'oinkle', weight: 2 },
    ],
  },
  {
    // Cloudlamb only drifts down on sunny days.
    id: 'wave-2-sunny-days',
    terrains: ['hills', 'mountains'],
    timeOfDay: 'day',
    entries: [{ species: 'cloudlamb', weight: 4 }],
  },
  {
    // Glimbug lights the way from dusk, in the woods and on the meadow.
    id: 'wave-2-dusk-lights',
    terrains: ['meadow', 'forest', 'old-forest'],
    timeOfDay: 'dusk',
    entries: [{ species: 'glimbug', weight: 2 }],
  },
  {
    id: 'wave-2-night-lights',
    terrains: ['meadow', 'forest', 'old-forest'],
    timeOfDay: 'night',
    entries: [{ species: 'glimbug', weight: 2 }],
  },
  {
    // The lake's one rare after dark: Lampfin blinks its light on and off.
    id: 'wave-2-lake-nights',
    terrains: ['lake'],
    timeOfDay: 'night',
    entries: [{ species: 'lampfin', weight: 1 }],
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
  // Thanksgiving (each species also carries `season: 'thanksgiving'`).
  {
    // Crunchkin plays in the leaves under the trees (and the home leaf piles).
    id: 'thanksgiving-leaves',
    terrains: ['forest', 'old-forest', 'meadow'],
    season: 'thanksgiving',
    entries: [{ species: 'crunchkin', weight: 4 }], // TUNE:
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
