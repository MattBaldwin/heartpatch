import type { GuardianRules } from '../../schemas/data/guardian-rules.js';

const EVERY_TERRAIN = [
  'meadow',
  'forest',
  'old-forest',
  'hills',
  'mountains',
  'lake',
  'pumpkin-fields',
  'junipers-gap',
];

/**
 * Tile guardians (design doc §11). Secret (CLAUDE.md rule 6): server-only.
 * A tile's `guardian_strength` (1–4 on ordinary land, 5 in Juniper's Gap,
 * `MAP_GEN.guardianStrength`) picks a tier; its guardians are rolled from
 * these tables once per window (`resolveGuardians`), so a retry after the
 * cooldown can meet a new team but never a reroll of the same one.
 */
export const GUARDIAN_RULES: GuardianRules = {
  windowHours: 24, // TUNE: one guardian team per tile per map-local day
  strengths: [
    { strength: 1, count: 1, levels: { min: 2, max: 4 } }, // TUNE: next to a home ring, a fresh squishy can win
    { strength: 2, count: 1, levels: { min: 4, max: 7 } }, // TUNE:
    { strength: 3, count: 2, levels: { min: 6, max: 9 } }, // TUNE:
    { strength: 4, count: 2, levels: { min: 9, max: 13 } }, // TUNE:
    { strength: 5, count: 3, levels: { min: 14, max: 18 } }, // TUNE: Juniper's Gap, the hardest guardians
  ],
  // Launch roster (#10). Ordinary land (levels 2–13) is guarded by base
  // forms; Juniper's Gap (levels 14–18) by evolved ones, the toughest
  // guardians on the map. TUNE: every weight.
  tables: [
    {
      id: 'meadow-guardians',
      terrains: ['meadow', 'pumpkin-fields'],
      entries: [
        { species: 'emberbun', weight: 3 },
        { species: 'fuzzbolt', weight: 3 },
        { species: 'fizzlepop', weight: 3 },
        { species: 'thistlepip', weight: 3 },
        { species: 'puddlepuff', weight: 2 },
      ],
    },
    {
      id: 'forest-guardians',
      terrains: ['forest', 'old-forest'],
      entries: [
        { species: 'thistlepip', weight: 3 },
        { species: 'nookling', weight: 3 },
        { species: 'mossmuffin', weight: 2 },
        { species: 'pebblesnooze', weight: 2 },
        { species: 'emberbun', weight: 2 },
      ],
    },
    {
      id: 'highland-guardians',
      terrains: ['hills', 'mountains'],
      entries: [
        { species: 'pebblesnooze', weight: 3 },
        { species: 'glimmerock', weight: 3 },
        { species: 'flurrypup', weight: 3 },
        { species: 'snoozicle', weight: 3 },
        { species: 'fuzzbolt', weight: 2 },
      ],
    },
    {
      id: 'lake-guardians',
      terrains: ['lake'],
      entries: [
        { species: 'puddlepuff', weight: 3 },
        { species: 'bubbletub', weight: 3 },
        { species: 'snoozicle', weight: 2 },
      ],
    },
    {
      id: 'gap-guardians',
      terrains: ['junipers-gap'],
      entries: [
        { species: 'splashmallow', weight: 2 },
        { species: 'boulderdoze', weight: 2 },
        { species: 'hearthbun', weight: 2 },
        { species: 'drowsiberg', weight: 2 },
        { species: 'frizzbolt', weight: 2 },
        { species: 'zingaling', weight: 2 },
        { species: 'bubbletide', weight: 2 },
        { species: 'bristlebloom', weight: 2 },
        { species: 'snugglenook', weight: 2 },
        { species: 'blusterpup', weight: 1 },
        { species: 'glittercrag', weight: 1 },
        { species: 'mossquilt', weight: 1 },
        { species: 'dazzledrop', weight: 1 },
        { species: 'thunderplume', weight: 1 },
      ],
    },
    {
      id: 'halloween-guardians',
      terrains: ['pumpkin-fields', 'old-forest'],
      season: 'halloween',
      entries: [
        { species: 'gourdon', weight: 3 },
        { species: 'candlekit', weight: 2 },
        { species: 'upsybat', weight: 2 },
        { species: 'glowboo', weight: 1 },
      ],
    },
    {
      id: 'halloween-gap-guardians',
      terrains: ['junipers-gap'],
      season: 'halloween',
      entries: [
        { species: 'glowgourd', weight: 2 },
        { species: 'wickwhisker', weight: 2 },
        { species: 'topsywing', weight: 2 },
        { species: 'brightboo', weight: 1 },
      ],
    },
    // TUNE: placeholder kept until its tests move to the roster (follow-up).
    {
      id: 'placeholder-guardians',
      terrains: EVERY_TERRAIN,
      entries: [{ species: 'placeholder-moonpuff', weight: 1 }],
    },
  ],
};
