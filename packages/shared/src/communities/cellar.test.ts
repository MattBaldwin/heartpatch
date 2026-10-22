import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { BIG_CHEST_KIND, cellarSpots, isBigChest, keyInReach } from './cellar.js';
import { searchSpots } from '../explore/index.js';
import { deriveSeed } from '../rng/index.js';

const tile = (q: number, r: number, ownerUserId: string | null = null) => ({
  q,
  r,
  terrain: 'meadow',
  homeSlot: null,
  ownerUserId,
});

describe('keyInReach (#306 PR 2c)', () => {
  const key = { q: 0, r: 0 };

  it('is true on my own key tile and next to any tile I hold', () => {
    expect(keyInReach(key, [tile(0, 0, 'me')], 'me')).toBe(true);
    expect(keyInReach(key, [tile(1, 0, 'me'), tile(0, 0)], 'me')).toBe(true);
  });

  it("is true next to my land whoever holds the key's tile", () => {
    expect(keyInReach(key, [tile(0, -1, 'me'), tile(0, 0, 'rival')], 'me')).toBe(true);
  });

  it('is false two steps away, or with no land', () => {
    expect(keyInReach(key, [tile(2, 0, 'me')], 'me')).toBe(false);
    expect(keyInReach(key, [tile(1, 0, 'rival')], 'me')).toBe(false);
  });
});

describe('cellarSpots (#306 PR 2c, chests)', () => {
  const { spots, kinds } = COMMUNITY_RULES.cellar;
  const seeds = ['a', 'b', 'c', 'village-seed', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6'];

  it("lays out the small chests the same every time, inside the kit's count, then the big chest", () => {
    for (const seed of seeds) {
      const laid = cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES);
      expect(cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES)).toEqual(laid);
      const small = laid.filter((s) => !isBigChest(s));
      expect(small.length).toBeGreaterThanOrEqual(spots.min);
      expect(small.length).toBeLessThanOrEqual(spots.max);
      expect(laid.map((s) => s.index)).toEqual(laid.map((_, i) => i));
      expect(laid.at(-1)).toMatchObject({ index: small.length, kind: BIG_CHEST_KIND, x: 0 });
      for (const s of laid) expect(s.tool).toBeNull();
      for (const s of small) expect(kinds.map((k) => k.kind)).toContain(s.kind);
    }
  });

  it('keeps each small chest the index and kind its spot had (saved progress still reads)', () => {
    for (const seed of seeds) {
      const kit = COMMUNITY_RULES.cellar;
      const before = searchSpots(
        deriveSeed(seed, 'cellar'),
        { q: 0, r: 0, terrain: kit.terrain },
        { ...EXPLORE_RULES, terrains: [kit] },
      )!;
      const small = cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES).slice(0, -1);
      expect(small.map((s) => [s.index, s.kind])).toEqual(before.map((s) => [s.index, s.kind]));
    }
  });

  it('stands the small chests in a row along the back, either side of the big one', () => {
    const { row, first, gap, big } = COMMUNITY_RULES.cellarChests;
    for (const seed of seeds) {
      const laid = cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES);
      const bigChest = laid.at(-1)!;
      expect(bigChest.z).toBe(big);
      const small = laid.slice(0, -1);
      // Never two in one place, all behind the middle, inside the tile.
      expect(new Set(small.map((s) => `${String(s.x)},${String(s.z)}`)).size).toBe(small.length);
      for (const s of small) {
        expect(s.z).toBeLessThanOrEqual(row);
        expect(s.z).toBeGreaterThan(0);
        expect(Math.abs(s.x)).toBeGreaterThanOrEqual(first);
        expect(Math.abs(s.x)).toBeLessThan(Math.sqrt(3) / 2);
      }
      // Right, left, right...: the row is balanced round the big chest.
      const right = small.filter((s) => s.x > 0).length;
      expect(right - (small.length - right)).toBeGreaterThanOrEqual(0);
      expect(right - (small.length - right)).toBeLessThanOrEqual(1);
      expect(Math.abs(small[0]!.x)).toBeCloseTo(first);
      if (small[2]) expect(Math.abs(small[2].x)).toBeCloseTo(first + gap);
    }
  });

  it('differs between villages in how many chests and which kinds', () => {
    const shapes = new Set(
      seeds.map((seed) =>
        cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES)
          .map((s) => s.kind)
          .join(),
      ),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });
});
