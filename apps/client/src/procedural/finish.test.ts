import { ART_RULES, FinishSchema, RaritySchema } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FINISH_CODE } from './config.js';

describe('rarity finishes (ART_BIBLE §1.4)', () => {
  it('gives every finish its own shader code below the glow bit', () => {
    const codes = FinishSchema.options.map((f) => FINISH_CODE[f]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toBeLessThan(FINISH_CODE.glow);
  });

  it('draws every rarity with a finish the shader knows, Mythic with the shimmer (#261)', () => {
    for (const rarity of RaritySchema.options) {
      expect(FINISH_CODE[ART_RULES.finishByRarity[rarity]], rarity).toBeDefined();
    }
    expect(FINISH_CODE[ART_RULES.finishByRarity.mythic]).toBe(FINISH_CODE.shimmer);
    expect(FINISH_CODE.shimmer).toBeGreaterThan(FINISH_CODE[ART_RULES.finishByRarity.legendary]);
  });
});
