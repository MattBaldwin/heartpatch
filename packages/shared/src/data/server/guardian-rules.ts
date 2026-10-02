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
  tables: [
    // TUNE: placeholder until #10's roster; Moonpuff is the only species yet.
    {
      id: 'placeholder-guardians',
      terrains: EVERY_TERRAIN,
      entries: [{ species: 'placeholder-moonpuff', weight: 1 }],
    },
  ],
};
