import { FinishSchema, RARE_GLOW_LEVEL, RaritySchema } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FINISH_CODE, RARE_GLOW, RARE_GLOW_CODE } from './config.js';
import { decodeSquishCode, glowHueIndex, rareGlowCode, rareGlowLevel } from './rare-glow.js';

describe('rare finds glow codes (#391)', () => {
  it('adds nothing below rare, or for a look with no rarity', () => {
    expect(rareGlowCode('common', ['#ff0000'])).toBe(0);
    expect(rareGlowCode('uncommon', ['#ff0000'])).toBe(0);
    expect(rareGlowCode(undefined, ['#ff0000'])).toBe(0);
  });

  it('takes the level from the shared rarity table', () => {
    for (const rarity of RaritySchema.options) {
      expect(rareGlowLevel(rarity), rarity).toBe(RARE_GLOW_LEVEL[rarity]);
    }
  });

  it('borrows the palette’s most colourful hue', () => {
    // Glowboo: near-white body, a pale gold and a lilac; the lilac is the most colourful.
    const lilac = glowHueIndex(['#f1ecff', '#fff6c7', '#c9b8ff']);
    expect(lilac * (360 / RARE_GLOW_CODE.hues)).toBeGreaterThan(240);
    expect(lilac * (360 / RARE_GLOW_CODE.hues)).toBeLessThan(270);
    // Pure red is hue 0; pure blue is two thirds round.
    expect(glowHueIndex(['#ffffff', '#ff0000'])).toBe(0);
    expect(glowHueIndex(['#0000ff'])).toBe(RARE_GLOW_CODE.hues * (2 / 3));
    // Every hue lands on one of the steps.
    for (const hex of ['#ff00ff', '#ff0001', '#123456']) {
      const i = glowHueIndex([hex]);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(RARE_GLOW_CODE.hues);
    }
  });

  it('sits above every finish sum, so the shader splits each code back exactly', () => {
    const finishes = [...FinishSchema.options, 'shimmerSoft'] as const;
    const bases = finishes.flatMap((f) =>
      [0, FINISH_CODE.glow].flatMap((g) =>
        [0, FINISH_CODE.offFace].map((o) => FINISH_CODE[f] + g + o),
      ),
    );
    expect(Math.max(...bases)).toBeLessThan(RARE_GLOW_CODE.level);
    expect(4 * RARE_GLOW_CODE.level + Math.max(...bases)).toBeLessThan(RARE_GLOW_CODE.hue);
    for (const base of bases) {
      for (let level = 0; level <= 4; level++) {
        for (let hue = 0; hue < RARE_GLOW_CODE.hues; hue++) {
          const code = base + level * RARE_GLOW_CODE.level + hue * RARE_GLOW_CODE.hue;
          // The code travels as a 32-bit float in the instance buffer.
          const sent = new Float32Array([code])[0]!;
          expect(decodeSquishCode(sent)).toEqual({ base, level, hue });
        }
      }
    }
  });

  it('steps the edge up with each level and the rainbow at legendary and mythic', () => {
    for (let i = 1; i < RARE_GLOW.edge.length; i++) {
      expect(RARE_GLOW.edge[i]).toBeGreaterThan(RARE_GLOW.edge[i - 1]!);
    }
    expect(RARE_GLOW.rainbow[0]).toBeGreaterThan(1);
    expect(RARE_GLOW.rainbow[1]).toBeGreaterThan(RARE_GLOW.rainbow[0]);
  });
});
