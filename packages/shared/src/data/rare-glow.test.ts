import { describe, expect, it } from 'vitest';
import { RaritySchema } from '../schemas/data/common.js';
import { ART_RULES, RARE_GLOW_LEVEL } from './visuals.js';

describe('rare finds glow (#391)', () => {
  it('gives every rarity a glow level from 0 to 4', () => {
    for (const rarity of RaritySchema.options) {
      expect([0, 1, 2, 3, 4], rarity).toContain(RARE_GLOW_LEVEL[rarity]);
    }
  });

  it('leaves common and uncommon unlit and lights rare and up', () => {
    expect(RARE_GLOW_LEVEL.common).toBe(0);
    expect(RARE_GLOW_LEVEL.uncommon).toBe(0);
    for (const rarity of ['rare', 'epic', 'legendary', 'mythic', 'secret'] as const) {
      expect(RARE_GLOW_LEVEL[rarity], rarity).toBeGreaterThan(0);
    }
  });

  it('never glows less at a rarer step of the ladder', () => {
    const ladder = RaritySchema.options.filter((r) => r !== 'secret');
    for (let i = 1; i < ladder.length; i++) {
      expect(RARE_GLOW_LEVEL[ladder[i]!], ladder[i]).toBeGreaterThanOrEqual(
        RARE_GLOW_LEVEL[ladder[i - 1]!],
      );
    }
  });

  it('brightens a rainbow edge only where the finish has one (legendary and up)', () => {
    // The client brightens the iridescent edge at level 3 and up instead of
    // adding its own; every rarity that reaches 3 must wear that edge.
    const rainbow = new Set(['iridescent', 'shimmer']);
    for (const rarity of RaritySchema.options) {
      if (RARE_GLOW_LEVEL[rarity] >= 3) {
        expect(rainbow.has(ART_RULES.finishByRarity[rarity]), rarity).toBe(true);
      } else {
        expect(rainbow.has(ART_RULES.finishByRarity[rarity]), rarity).toBe(false);
      }
    }
  });
});
