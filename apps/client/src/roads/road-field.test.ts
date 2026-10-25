import { describe, expect, it } from 'vitest';
import { hexRimDisc } from './road-field.js';

describe('ferry tint shape (#621 W1-6)', () => {
  it('is a hex disc with a rim ring: fill inside, rim colour on the outside', () => {
    const fill = [0.1, 0.2, 0.3, 0.5];
    const rim = [0.9, 0.9, 0.9, 1];
    const m = hexRimDisc(1, 0.2, fill, rim);
    const verts = m.positions.length / 3;
    expect(m.colors.length / 4).toBe(verts);
    // Disc: centre + 6; ring: 6 inner + 6 outer vertices; 6 + 12 triangles.
    expect(verts).toBe(19);
    expect(m.indices.length).toBe(3 * 18);
    expect(Math.max(...m.indices)).toBeLessThan(verts);
    const radius = (i: number) => Math.hypot(m.positions[i * 3] ?? 0, m.positions[i * 3 + 2] ?? 0);
    expect(Math.max(...Array.from({ length: verts }, (_, i) => radius(i)))).toBeCloseTo(1);
    expect(m.colors.slice(0, 4)).toEqual(fill);
    expect(m.colors.slice(-4)).toEqual(rim);
  });
});
