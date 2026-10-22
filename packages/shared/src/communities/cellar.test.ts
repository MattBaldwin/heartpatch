import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { cellarSpots, keyInReach } from './cellar.js';

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
