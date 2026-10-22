import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { isSearched, searchSpots, withSearched } from '../explore/index.js';
import { MAX_SEARCH_SPOTS } from '../schemas/data/explore.js';
import { cellarSpots, KEY_SPOT, keyInReach, keySpot } from './cellar.js';

const tile = (q: number, r: number, ownerUserId: string | null = null) => ({
  q,
  r,
  terrain: 'meadow',
  homeSlot: null,
  ownerUserId,
});

describe('keyInReach (owner decision 2026-10-22: own the key tile itself)', () => {
  const key = { q: 0, r: 0 };

  it('is true only on my own key tile', () => {
    expect(keyInReach(key, [tile(0, 0, 'me')], 'me')).toBe(true);
    expect(keyInReach(key, [tile(1, 0, 'me'), tile(0, 0, 'me')], 'me')).toBe(true);
  });

  it("is false next to it, wild or a rival's: the Keeper wins that tile first", () => {
    expect(keyInReach(key, [tile(1, 0, 'me'), tile(0, 0)], 'me')).toBe(false);
    expect(keyInReach(key, [tile(0, -1, 'me'), tile(0, 0, 'rival')], 'me')).toBe(false);
    expect(keyInReach(key, [tile(2, 0, 'me')], 'me')).toBe(false);
    expect(keyInReach(key, [], 'me')).toBe(false);
  });
});

describe('keySpot (owner decision 2026-10-22: found by exploring)', () => {
  const apart2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

  it('sits past every progress bit, so it never counts toward a tile', () => {
    expect(KEY_SPOT.index).toBe(MAX_SEARCH_SPOTS);
    expect(isSearched(-1 >>> 1, KEY_SPOT.index)).toBe(false);
    expect(() => withSearched(0, KEY_SPOT.index)).toThrow(RangeError);
  });

  it("lands in the same place every time, in the open between the tile's own spots", () => {
    for (const terrain of ['meadow', 'forest', 'lake', 'hills', 'mountains', 'pumpkin-fields']) {
      for (const seed of ['a', 'b', 'map-seed']) {
        const spots = searchSpots(seed, { q: 3, r: -2, terrain }, EXPLORE_RULES) ?? [];
        const spot = keySpot(`${seed}:key`, spots, EXPLORE_RULES);
        expect(keySpot(`${seed}:key`, spots, EXPLORE_RULES)).toEqual(spot);
        expect(spot).toMatchObject({ index: KEY_SPOT.index, kind: 'cellar-key', tool: null });
        // Well inside the tile: |x| / √3 + |z| is 1 at its edge.
        expect(Math.abs(spot.x) / Math.sqrt(3) + Math.abs(spot.z)).toBeLessThanOrEqual(0.7);
        for (const s of spots) {
          expect(apart2(s, spot)).toBeGreaterThanOrEqual(EXPLORE_RULES.placement.minGap ** 2);
        }
      }
    }
  });
});

describe('cellarSpots (#306 PR 2c)', () => {
  const { spots, kinds } = COMMUNITY_RULES.cellar;

  it('lays out the cellar kit the same every time, inside its spot count', () => {
    for (const seed of ['a', 'b', 'c', 'village-seed']) {
      const laid = cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES);
      expect(cellarSpots(seed, COMMUNITY_RULES, EXPLORE_RULES)).toEqual(laid);
      expect(laid.length).toBeGreaterThanOrEqual(spots.min);
      expect(laid.length).toBeLessThanOrEqual(spots.max);
      expect(laid.map((s) => s.index)).toEqual(laid.map((_, i) => i));
      for (const s of laid) {
        expect(kinds.map((k) => k.kind)).toContain(s.kind);
        expect(s.tool).toBeNull();
      }
    }
  });

  it('differs between villages', () => {
    const a = cellarSpots('village-a', COMMUNITY_RULES, EXPLORE_RULES);
    const b = cellarSpots('village-b', COMMUNITY_RULES, EXPLORE_RULES);
    expect(a).not.toEqual(b);
  });
});
