import { describe, expect, it } from 'vitest';
import {
  HEX_DIRECTIONS,
  HexSchema,
  hex,
  hexAdd,
  hexBfs,
  hexDistance,
  hexEquals,
  hexFromKey,
  hexKey,
  hexNeighbors,
  hexRing,
  hexScale,
  hexSpiral,
  type Hex,
} from './index.js';

const origin = hex(0, 0);
const keys = (hexes: readonly Hex[]) => hexes.map(hexKey);

describe('hex basics', () => {
  it('normalises -0 so equal hexes are deeply equal', () => {
    const h = hex(-0, -0);
    expect(Object.is(h.q, 0)).toBe(true);
    expect(Object.is(h.r, 0)).toBe(true);
    expect(hexScale(hex(0, 3), -1)).toEqual(hex(0, -3));
  });

  it('round-trips keys, including negatives', () => {
    for (const h of [hex(0, 0), hex(-3, 7), hex(12, -12)]) {
      expect(hexFromKey(hexKey(h))).toEqual(h);
    }
    expect(hexKey(hex(-3, 7))).toBe('-3,7');
  });

  it('adds, scales and compares', () => {
    expect(hexAdd(hex(1, -2), hex(3, 4))).toEqual(hex(4, 2));
    expect(hexScale(hex(1, -2), 3)).toEqual(hex(3, -6));
    expect(hexEquals(hex(2, 3), hex(2, 3))).toBe(true);
    expect(hexEquals(hex(2, 3), hex(3, 2))).toBe(false);
  });

  it('validates coordinates as smallint-sized integers', () => {
    expect(HexSchema.safeParse({ q: 3, r: -4 }).success).toBe(true);
    expect(HexSchema.safeParse({ q: 1.5, r: 0 }).success).toBe(false);
    expect(HexSchema.safeParse({ q: 40000, r: 0 }).success).toBe(false);
    expect(HexSchema.safeParse({ q: 0, r: 0, s: 0 }).success).toBe(false);
  });
});

describe('hexNeighbors', () => {
  it('returns six distinct hexes, each one step away, in direction order', () => {
    const center = hex(2, -5);
    const neighbors = hexNeighbors(center);
    expect(neighbors).toHaveLength(6);
    expect(new Set(keys(neighbors)).size).toBe(6);
    for (const n of neighbors) expect(hexDistance(center, n)).toBe(1);
    expect(neighbors).toEqual(HEX_DIRECTIONS.map((d) => hexAdd(center, d)));
  });

  it('has opposite directions three apart', () => {
    HEX_DIRECTIONS.forEach((d, i) => {
      expect(hexAdd(d, HEX_DIRECTIONS[(i + 3) % 6]!)).toEqual(origin);
    });
  });
});

describe('hexDistance', () => {
  it('counts steps between hexes', () => {
    expect(hexDistance(origin, origin)).toBe(0);
    expect(hexDistance(origin, hex(3, 0))).toBe(3);
    expect(hexDistance(origin, hex(3, -3))).toBe(3);
    expect(hexDistance(origin, hex(2, 1))).toBe(3);
    expect(hexDistance(hex(-2, 4), hex(3, -1))).toBe(5);
  });

  it('is symmetric and obeys the triangle inequality', () => {
    const area = hexSpiral(origin, 3);
    for (const a of area) {
      for (const b of area) {
        const ab = hexDistance(a, b);
        expect(hexDistance(b, a)).toBe(ab);
        expect(ab).toBeLessThanOrEqual(hexDistance(a, origin) + hexDistance(origin, b));
      }
    }
  });
});

describe('hexRing', () => {
  it('is just the centre at radius 0', () => {
    expect(hexRing(hex(4, 4), 0)).toEqual([hex(4, 4)]);
  });

  it('has 6 × radius distinct hexes, all exactly radius away', () => {
    const center = hex(-1, 2);
    for (const radius of [1, 2, 5, 12]) {
      const ring = hexRing(center, radius);
      expect(ring).toHaveLength(6 * radius);
      expect(new Set(keys(ring)).size).toBe(6 * radius);
      for (const h of ring) expect(hexDistance(center, h)).toBe(radius);
    }
  });

  it('walks around the ring one neighbour at a time', () => {
    const ring = hexRing(origin, 4);
    ring.forEach((h, i) => {
      expect(hexDistance(h, ring[(i + 1) % ring.length]!)).toBe(1);
    });
  });

  it('rejects negative and fractional radii', () => {
    expect(() => hexRing(origin, -1)).toThrow(RangeError);
    expect(() => hexRing(origin, 1.5)).toThrow(RangeError);
  });
});

describe('hexSpiral', () => {
  it('holds the map sizes from design doc §3', () => {
    expect(hexSpiral(origin, 9)).toHaveLength(271);
    expect(hexSpiral(origin, 11)).toHaveLength(397);
    expect(hexSpiral(origin, 12)).toHaveLength(469);
  });

  it('lists every hex within the radius once, nearest rings first', () => {
    const spiral = hexSpiral(hex(3, -1), 4);
    expect(new Set(keys(spiral)).size).toBe(spiral.length);
    const steps = spiral.map((h) => hexDistance(hex(3, -1), h));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(spiral[0]).toEqual(hex(3, -1));
  });
});

describe('hexBfs', () => {
  it('matches hexDistance on open ground', () => {
    const area = new Set(keys(hexSpiral(origin, 5)));
    const steps = hexBfs([origin], (h) => area.has(hexKey(h)));
    expect(steps.size).toBe(area.size);
    for (const [key, distance] of steps) {
      expect(distance).toBe(hexDistance(origin, hexFromKey(key)));
    }
  });

  it('walks around walls and never enters them', () => {
    // A wall along q = 1 except for a gap at r = -3.
    const area = new Set(keys(hexSpiral(origin, 4)));
    const wall = (h: Hex) => h.q === 1 && h.r !== -3;
    const steps = hexBfs([origin], (h) => area.has(hexKey(h)) && !wall(h));
    expect(steps.has(hexKey(hex(1, 0)))).toBe(false);
    expect(steps.get(hexKey(hex(2, 0)))).toBeGreaterThan(hexDistance(origin, hex(2, 0)));
    expect(steps.get(hexKey(hex(1, -3)))).toBe(3);
  });

  it('reports stranded hexes as unreached', () => {
    const owned = new Set(keys([origin, hex(1, 0), hex(3, 0)]));
    const reached = hexBfs([origin], (h) => owned.has(hexKey(h)));
    expect([...reached.keys()]).toEqual(['0,0', '1,0']);
  });

  it('measures from the nearest of several starts, which are always included', () => {
    const area = new Set(keys(hexSpiral(origin, 6)));
    const starts = [hex(-4, 0), hex(4, 0), hex(-4, 0)];
    const steps = hexBfs(starts, (h) => area.has(hexKey(h)) && h.q !== -4);
    expect(steps.get(hexKey(hex(-4, 0)))).toBe(0);
    expect(steps.get(hexKey(hex(4, 0)))).toBe(0);
    expect(steps.get(hexKey(origin))).toBe(4);
  });

  it('returns nothing for no starts', () => {
    expect(hexBfs([], () => true).size).toBe(0);
  });
});
