import { ART_RULES, FinishSchema, RaritySchema } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FINISH, FINISH_CODE } from './config.js';

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

  it('keeps the squishies’ finish codes and shimmer as they were (#261)', () => {
    // The soft shimmer is added beside them: the existing codes keep their values.
    expect([
      FINISH_CODE.vinyl,
      FINISH_CODE.sparkle,
      FINISH_CODE.iridescent,
      FINISH_CODE.shimmer,
    ]).toEqual([0, 1, 2, 3]);
    expect(FINISH.shimmer).toEqual({
      bands: 3.2,
      width: 0.12,
      strength: 0.26,
      tint: [1, 0.9, 0.98],
    });
    // Squishies still draw Mythic with the shared shimmer, not the soft one.
    expect(ART_RULES.finishByRarity.mythic).toBe('shimmer');
  });

  it('decodes every finish and glow sum back to the same pair, as the shader does', () => {
    // The shader: glow when the code reaches the glow code, then the tier is what is left.
    const decode = (code: number) => {
      const glow = code >= FINISH_CODE.glow - 0.5;
      return { tier: code - (glow ? FINISH_CODE.glow : 0), glow };
    };
    const finishes = [...FinishSchema.options, 'shimmerSoft'] as const;
    for (const finish of finishes) {
      for (const glow of [false, true]) {
        const code = FINISH_CODE[finish] + (glow ? FINISH_CODE.glow : 0);
        expect(decode(code), `${finish} ${String(glow)}`).toEqual({
          tier: FINISH_CODE[finish],
          glow,
        });
      }
    }
    // The soft shimmer sits above the shared one and below the glow code.
    expect(FINISH_CODE.shimmerSoft).toBeGreaterThan(FINISH_CODE.shimmer);
    expect(FINISH_CODE.shimmerSoft).toBeLessThan(FINISH_CODE.glow);
  });

  it('makes the soft shimmer gentler: fewer, wider bands at lower strength (owner, #261)', () => {
    expect(FINISH.shimmerSoft.bands).toBeLessThan(FINISH.shimmer.bands);
    expect(FINISH.shimmerSoft.width).toBeGreaterThan(FINISH.shimmer.width);
    expect(FINISH.shimmerSoft.strength).toBeLessThan(FINISH.shimmer.strength);
  });
});
