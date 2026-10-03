import { describe, expect, it } from 'vitest';
import { BATTLE_RULES } from '../battle.js';
import { GAME_DATA } from '../index.js';
import { MAP_GEN } from '../map-gen.js';
import { checkGuardianRules } from '../../schemas/data/guardian-rules.js';
import { GUARDIAN_RULES } from './guardian-rules.js';
import { SECRET_SPECIES } from './secret-species.js';

describe('guardian rules', () => {
  it('accepts the shipped rules', () => {
    expect(checkGuardianRules(GUARDIAN_RULES)).toEqual([]);
  });

  it('refuses muddled tiers and windows', () => {
    expect(checkGuardianRules({ ...GUARDIAN_RULES, windowHours: 5 }).join()).toMatch(/divide 24/);
    expect(
      checkGuardianRules({
        ...GUARDIAN_RULES,
        strengths: [...GUARDIAN_RULES.strengths].reverse(),
      }).join(),
    ).toMatch(/weakest first/);
    expect(
      checkGuardianRules({ ...GUARDIAN_RULES, hint: { easyUpTo: 10, toughUpTo: 10 } }).join(),
    ).toMatch(/less than toughUpTo/);
  });

  it('guards every terrain with species the server knows, at every strength the map makes', () => {
    const species = new Set([...GAME_DATA.species, ...SECRET_SPECIES].map((s) => s.id));
    for (const table of GUARDIAN_RULES.tables) {
      for (const entry of table.entries) expect(species).toContain(entry.species);
    }
    for (const terrain of GAME_DATA.terrains) {
      expect(GUARDIAN_RULES.tables.some((t) => t.terrains.includes(terrain.id))).toBe(true);
    }
    const strengths = new Set(GUARDIAN_RULES.strengths.map((t) => t.strength));
    for (let s = MAP_GEN.guardianStrength.min; s <= MAP_GEN.guardianStrength.max; s += 1) {
      expect(strengths).toContain(s);
    }
    expect(strengths).toContain(MAP_GEN.guardianStrength.gap);
    // A guardian team is one battle side.
    for (const tier of GUARDIAN_RULES.strengths) {
      expect(tier.count).toBeLessThanOrEqual(BATTLE_RULES.teamSize);
    }
  });
});
