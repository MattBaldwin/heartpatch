import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { isSearched, searchSpots, withSearched } from '../explore/index.js';
import { MAX_SEARCH_SPOTS } from '../schemas/data/explore.js';
import { hexKey } from '../hex/index.js';
import { cellarSpots, KEY_SPOT, keyInReach, keyMoveTo, keySpot } from './cellar.js';

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

describe('keys on a patch with no challenges (owner decision 2026-10-22)', () => {
  const key = { q: 0, r: 0 };
  /** A small patch: every tile within 3 steps, wild meadow unless said. */
  const patch = (
    owners: Record<string, string | null> = {},
    terrain: Record<string, string> = {},
  ) => {
    const out = [];
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        if (Math.abs(q + r) > 3) continue;
        const k = `${String(q)},${String(r)}`;
        out.push({
          q,
          r,
          terrain: terrain[k] ?? 'meadow',
          homeSlot: null,
          communityId: null,
          ownerUserId: owners[k] ?? null,
        });
      }
    }
    return out;
  };
  const rules = {
    pvpMode: 'off' as const,
    range: 2,
    taken: new Set<`${number},${number}`>(),
    gapTerrain: 'junipers-gap',
    excludedTerrains: ['lake'],
  };

  it("moves a key off another Keeper's land to the nearest wild tile, the same every time", () => {
    const tiles = patch({ '0,0': 'rival', '1,0': 'rival', '0,1': 'rival' });
    const to = keyMoveTo(key, tiles, 'me', rules);
    expect(to).not.toBeNull();
    expect(Math.max(Math.abs(to!.q), Math.abs(to!.r), Math.abs(to!.q + to!.r))).toBe(1);
    expect(tiles.find((t) => t.q === to!.q && t.r === to!.r)?.ownerUserId).toBeNull();
    expect(keyMoveTo(key, tiles, 'me', rules)).toEqual(to);
    // Never onto another key, a lake, a post or the Gap.
    const others = keyMoveTo(key, tiles, 'me', { ...rules, taken: new Set([hexKey(to!)]) });
    expect(others).not.toEqual(to);
  });

  it('stays on wild land, on my own land, and on patches with challenges', () => {
    expect(keyMoveTo(key, patch(), 'me', rules)).toBeNull();
    expect(keyMoveTo(key, patch({ '0,0': 'me' }), 'me', rules)).toBeNull();
    for (const pvpMode of ['on', 'gentle'] as const) {
      expect(keyMoveTo(key, patch({ '0,0': 'rival' }), 'me', { ...rules, pvpMode })).toBeNull();
    }
  });

  it('stays when no wild tile is near enough, and then land next to it is enough', () => {
    const owners: Record<string, string> = {};
    for (const t of patch()) owners[hexKey(t)] = 'rival';
    owners['1,0'] = 'me';
    const tiles = patch(owners);
    expect(keyMoveTo(key, tiles, 'me', rules)).toBeNull();
    expect(keyInReach(key, tiles, 'me', 'off')).toBe(true);
    expect(keyInReach(key, tiles, 'me', 'gentle')).toBe(false);
    expect(keyInReach(key, tiles, 'me', 'on')).toBe(false);
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

  it("lands in the same place every time, as far from the tile's own spots as it can", () => {
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
