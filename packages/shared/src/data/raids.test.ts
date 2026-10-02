import { describe, expect, it } from 'vitest';
import { DefenseStanceSchema, checkRaidRules } from '../schemas/data/raids.js';
import { BATTLE_RULES } from './battle.js';
import { RAID_RULES, stanceOfPolicy, stancePolicy } from './raids.js';

describe('raid rules (#16)', () => {
  it('are valid', () => {
    expect(checkRaidRules(RAID_RULES)).toEqual([]);
    expect(checkRaidRules({ ...RAID_RULES, defaultStance: 'sneaky' })).not.toEqual([]);
  });

  it('defaults to Balanced (design doc §6)', () => {
    expect(RAID_RULES.defaultStance).toBe('balanced');
  });

  it('maps each stance onto the engine policy of the same name', () => {
    expect(stancePolicy('aggressive')).toBe('aggressive');
    expect(stancePolicy('defensive')).toBe('defensive');
    expect(stancePolicy('balanced')).toBe('balanced');
    for (const stance of DefenseStanceSchema.options) {
      // A real engine policy, and never the wild or guardian one.
      expect(BATTLE_RULES.ai[stancePolicy(stance)]).toBeDefined();
      expect(['wild', 'guardian']).not.toContain(stancePolicy(stance));
    }
  });

  it('reads the stance back from a stored policy; guardians have none', () => {
    for (const stance of DefenseStanceSchema.options) {
      expect(stanceOfPolicy(stancePolicy(stance))).toBe(stance);
    }
    expect(stanceOfPolicy('guardian')).toBeNull();
    expect(stanceOfPolicy('wild')).toBeNull();
  });

  it('uses the rules it is given', () => {
    const rules = {
      stancePolicies: { aggressive: 'guardian', defensive: 'defensive', balanced: 'balanced' },
    } as const;
    expect(stancePolicy('aggressive', rules)).toBe('guardian');
    expect(stanceOfPolicy('guardian', rules)).toBe('aggressive');
  });
});
