import { describe, expect, it } from 'vitest';
import { RaritySchema } from '../schemas/data/common.js';
import { RareFindTiersSchema } from '../schemas/data/rare-finds.js';
import { RARE_FIND_TIERS, rareFindTier } from './rare-finds.js';

describe('rare finds by tier (#391)', () => {
  it('has a moment for Rare and up only', () => {
    const has = RaritySchema.options.filter((r) => rareFindTier(r) !== null);
    expect(has).toEqual(['rare', 'epic', 'legendary', 'mythic', 'secret']);
  });

  it('grows up the ladder: a longer, bigger moment at each step', () => {
    const ladder = (['rare', 'epic', 'legendary'] as const).map((r) => RARE_FIND_TIERS[r]!);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.ms).toBeGreaterThan(ladder[i - 1]!.ms);
      expect(ladder[i]!.scale).toBeGreaterThan(ladder[i - 1]!.scale);
    }
  });

  it('gives secret kinds the Legendary-size moment, called Special, with no patch line', () => {
    const secret = RARE_FIND_TIERS.secret!;
    const legendary = RARE_FIND_TIERS.legendary!;
    expect(secret).toMatchObject({ ms: legendary.ms, scale: legendary.scale, label: 'Special' });
    expect(secret.patchLine).toBe(false);
    expect(JSON.stringify(secret).toLowerCase()).not.toContain('secret');
  });

  it('ships no Mythic row in Phase 1; Mythic gets at least the Legendary moment', () => {
    expect(RARE_FIND_TIERS).not.toHaveProperty('mythic');
    expect(rareFindTier('mythic')).toBe(RARE_FIND_TIERS.legendary);
  });

  it('is one new row to add a tier, and takes it over the fallback', () => {
    const mythic = { ms: 2600, scale: 4, label: 'Mythic', banner: 'Wow!', patchLine: true };
    const tiers = RareFindTiersSchema.parse({ ...RARE_FIND_TIERS, mythic });
    expect(rareFindTier('mythic', tiers)).toEqual(mythic);
    expect(rareFindTier('common', tiers)).toBeNull();
    expect(rareFindTier('uncommon', tiers)).toBeNull();
  });

  it('refuses a malformed row', () => {
    expect(() =>
      RareFindTiersSchema.parse({ rare: { ms: 10, scale: 1, label: 'Rare', banner: 'x' } }),
    ).toThrow();
  });
});
