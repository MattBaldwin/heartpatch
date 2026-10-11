import { hexToWorld } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { buildAreaAt } from './build-area-layout.js';
import { edgeTransform } from './fence-layout.js';

const SIZE = 0.65;
const tile = { q: 2, r: -1 };

describe('where a tap lands on a tile being built on (#371)', () => {
  it('finds each edge from a point toward it, the way fences are laid', () => {
    for (let edge = 0; edge < 6; edge++) {
      const at = edgeTransform(tile, edge, SIZE);
      expect(buildAreaAt(tile, at, SIZE)).toEqual({ edge });
    }
  });

  it('keeps every edge a wide wedge, even near the middle', () => {
    const c = hexToWorld(tile, SIZE);
    // 20° off the east edge's direction, halfway out: still east.
    const a = (20 * Math.PI) / 180;
    const r = SIZE * 0.6;
    expect(buildAreaAt(tile, { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, SIZE)).toEqual(
      { edge: 0 },
    );
    // 40° off is the next edge's wedge.
    const b = (40 * Math.PI) / 180;
    expect(buildAreaAt(tile, { x: c.x + Math.cos(b) * r, z: c.z + Math.sin(b) * r }, SIZE)).toEqual(
      { edge: 1 },
    );
  });

  it('calls the middle the middle, and far away nothing', () => {
    const c = hexToWorld(tile, SIZE);
    expect(buildAreaAt(tile, { x: c.x + 0.05, z: c.z - 0.05 }, SIZE)).toBe('centre');
    expect(buildAreaAt(tile, { x: c.x + SIZE * 2, z: c.z }, SIZE)).toBeNull();
  });
});
