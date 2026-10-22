import { describe, expect, it } from 'vitest';
import { KEY_GLOW } from './hollowed-config.js';
import { keyGlowArrays } from './key-glow-mesh.js';

describe("the cellar key tile's glow (#306: really highlight it)", () => {
  const glow = keyGlowArrays({ radius: 0.6, corner: 0.2, segments: 3 });
  const vertices = glow.positions.length / 3;

  it('is one well-formed vertex-coloured mesh', () => {
    expect(glow.colors).toHaveLength(vertices * 4);
    expect(glow.indices.length % 3).toBe(0);
    expect(glow.indices.every((i) => Number.isInteger(i) && i >= 0 && i < vertices)).toBe(true);
  });

  it('rises in a column of light that fades out at its top, with sparkles inside it', () => {
    const ys = Array.from({ length: vertices }, (_, i) => glow.positions[i * 3 + 1]!);
    const top = KEY_GLOW.column[KEY_GLOW.column.length - 1]!;
    expect(Math.max(...ys)).toBeCloseTo(top.y, 5);
    for (let i = 0; i < vertices; i++) {
      if (ys[i] === top.y) expect(glow.colors![i * 4 + 3]).toBe(0);
    }
    for (const s of KEY_GLOW.sparkles) {
      expect(s.y + s.size).toBeLessThan(top.y);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(KEY_GLOW.column[0].scale);
    }
  });

  it('has a bright rim round the tile, brighter than its fill', () => {
    expect(KEY_GLOW.rim.alpha).toBeGreaterThan(KEY_GLOW.fill);
    expect(KEY_GLOW.rim.peak).toBeGreaterThan(KEY_GLOW.rim.inner);
    expect(glow.colors!.some((c, i) => i % 4 === 3 && c === KEY_GLOW.rim.alpha)).toBe(true);
  });
});
