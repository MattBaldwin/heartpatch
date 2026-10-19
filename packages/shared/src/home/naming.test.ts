import { describe, expect, it } from 'vitest';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { NAMING_RULES } from '../data/naming.js';
import { HomeNameSchema } from '../schemas/buildings.js';
import { NamingRulesSchema } from '../schemas/data/naming.js';
import { namingGate, type NamingFacts } from './naming.js';

const kinds = HOME_BASE_RULES.buildableKinds;
const all: NamingFacts = {
  kindsBuilt: [...kinds],
  caughtCount: NAMING_RULES.caughtToName,
  heartSeedLevel: 1,
  homeNamedAtLevel: null,
};
const gate = (facts: Partial<NamingFacts>) =>
  namingGate({ ...all, ...facts }, NAMING_RULES, kinds);

describe('NAMING_RULES', () => {
  it('passes its schema', () => {
    expect(NamingRulesSchema.parse(NAMING_RULES)).toEqual(NAMING_RULES);
  });
});

describe('namingGate', () => {
  it('unlocks with one of each kind and enough squishies caught', () => {
    expect(gate({})).toMatchObject({ unlocked: true, renameOpen: true });
  });

  it('stays locked with a kind missing, listing kinds in data order', () => {
    const result = gate({ kindsBuilt: ['habitat', 'hearthfire'] });
    expect(result.unlocked).toBe(false);
    expect(result.renameOpen).toBe(false);
    expect(result.kinds.map((k) => k.kind)).toEqual(kinds);
    expect(result.kinds.filter((k) => k.built).map((k) => k.kind)).toEqual([
      'hearthfire',
      'habitat',
    ]);
  });

  it('stays locked one squishy short, and caps the meter at need', () => {
    expect(gate({ caughtCount: NAMING_RULES.caughtToName - 1 }).unlocked).toBe(false);
    expect(gate({ caughtCount: 99 })).toMatchObject({
      caught: NAMING_RULES.caughtToName,
      need: NAMING_RULES.caughtToName,
    });
  });

  it('ignores kinds that are not buildable', () => {
    expect(gate({ kindsBuilt: [...kinds, 'house'] }).unlocked).toBe(true);
  });

  it('closes after naming until the Heart Seed grows', () => {
    expect(gate({ homeNamedAtLevel: 1 })).toMatchObject({ unlocked: true, renameOpen: false });
    expect(gate({ homeNamedAtLevel: 1, heartSeedLevel: 2 }).renameOpen).toBe(true);
  });
});

describe('HomeNameSchema', () => {
  it('trims, squashes spaces and allows up to maxLength', () => {
    expect(HomeNameSchema.parse('  Puddle   Corner ')).toBe('Puddle Corner');
    expect(HomeNameSchema.parse('x'.repeat(NAMING_RULES.maxLength))).toHaveLength(
      NAMING_RULES.maxLength,
    );
  });

  it('refuses empty, too long and emoji names', () => {
    expect(HomeNameSchema.safeParse('   ').success).toBe(false);
    expect(HomeNameSchema.safeParse('x'.repeat(NAMING_RULES.maxLength + 1)).success).toBe(false);
    expect(HomeNameSchema.safeParse('Home 🏡').success).toBe(false);
  });
});
