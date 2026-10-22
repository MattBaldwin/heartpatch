import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { isExplorable } from '../explore/index.js';
import { hexDistance, hexKey, hexNeighbors } from '../hex/index.js';
import { farHollowLayout, farHollowSeed } from './far-hollow.js';

const rules = COMMUNITY_RULES.farHollow;
const halloween = { id: 'halloween', year: 2026 };

describe('farHollowSeed (#306 PR 6)', () => {
  it('is fixed for a map and season, and new for the next season or another map', () => {
    const seed = farHollowSeed('map-seed', halloween);
    expect(farHollowSeed('map-seed', halloween)).toBe(seed);
    expect(farHollowSeed('map-seed', { id: 'thanksgiving', year: 2026 })).not.toBe(seed);
    expect(farHollowSeed('map-seed', { id: 'halloween', year: 2027 })).not.toBe(seed);
    expect(farHollowSeed('other-map', halloween)).not.toBe(seed);
  });
});

describe('farHollowLayout (#306 PR 6)', () => {
  const layouts = Array.from({ length: 200 }, (_, i) =>
    farHollowLayout(farHollowSeed(`map-${String(i)}`, halloween), rules),
  );

  it('is the same for the same seed', () => {
    const seed = farHollowSeed('map-seed', halloween);
    expect(farHollowLayout(seed, rules)).toEqual(farHollowLayout(seed, rules));
  });

  it('has 7 to 9 tiles: the middle, its 6 neighbours, then tiles past them', () => {
    const sizes = new Set<number>();
    for (const tiles of layouts) {
      sizes.add(tiles.length);
      expect(tiles.length).toBeGreaterThanOrEqual(rules.tiles.min);
      expect(tiles.length).toBeLessThanOrEqual(rules.tiles.max);
      expect(tiles.map((t) => t.index)).toEqual(tiles.map((_, i) => i));
      expect(tiles[0]).toMatchObject({ q: 0, r: 0 });
      expect(tiles.slice(1, 7).every((t) => hexDistance(t, { q: 0, r: 0 }) === 1)).toBe(true);
      expect(new Set(tiles.map(hexKey)).size).toBe(tiles.length);
      // Every tile past the ring touches two of it: one cosy blob.
      const keys = new Set(tiles.map(hexKey));
      for (const t of tiles.slice(7)) {
        expect(hexDistance(t, { q: 0, r: 0 })).toBe(2);
        expect(hexNeighbors(t).filter((n) => keys.has(hexKey(n))).length).toBeGreaterThanOrEqual(2);
      }
    }
    expect([...sizes].sort()).toEqual([7, 8, 9]);
  });

  it('only uses explorable terrains, and every one of them turns up', () => {
    const seen = new Set(layouts.flat().map((t) => t.terrain));
    expect([...seen].sort()).toEqual(rules.terrains.map((t) => t.terrain).sort());
    for (const terrain of seen) expect(isExplorable(terrain, EXPLORE_RULES)).toBe(true);
  });
});
