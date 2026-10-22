import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { isSearched, searchSpots, withSearched } from '../explore/index.js';
import { MAX_SEARCH_SPOTS } from '../schemas/data/explore.js';
import { hexKey } from '../hex/index.js';
import { deriveSeed } from '../rng/index.js';
import {
  BIG_CHEST_KIND,
  cellarSpots,
  isBigChest,
  KEY_SPOT,
  keyInReach,
  keyMoveTo,
  keySpot,
} from './cellar.js';

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

  it('never moves onto a lake, the Gap, a post, a home or a village, and breaks ties by (q, r)', () => {
    // Only the ring round the key is near enough; every tile on it is ruled out but one.
    const blocked: Record<string, string> = {
      '1,0': 'lake',
      '1,-1': 'junipers-gap',
      '0,-1': 'trading-post',
    };
    const base = patch({ '0,0': 'rival' }, blocked).map((t) => {
      const k = hexKey(t);
      if (k === '-1,0') return { ...t, homeSlot: 0 };
      if (k === '-1,1') return { ...t, communityId: 'village' };
      return t;
    });
    expect(keyMoveTo(key, base, 'me', { ...rules, range: 1 })).toEqual({ q: 0, r: 1 });
    // With two equally near wild tiles, the lower q (then r) wins.
    const two = base.map((t) => (hexKey(t) === '-1,1' ? { ...t, communityId: null } : t));
    expect(keyMoveTo(key, two, 'me', { ...rules, range: 1 })).toEqual({ q: -1, r: 1 });
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

  it("keeps the fullest cellar's row inside the tile, with room for the big chest's bit", () => {
    // The seeds above may never draw the kit's most chests: check it from the data.
    const { row, first, gap, curve } = COMMUNITY_RULES.cellarChests;
    const out = Math.floor((spots.max - 1) / 2);
    expect(first + out * gap).toBeLessThan(Math.sqrt(3) / 2);
    expect(row - out * curve).toBeGreaterThan(0);
    // The big chest's index is the small chests' count: one more bit in `cellar_searched`.
    expect(spots.max + 1).toBeLessThanOrEqual(MAX_SEARCH_SPOTS);
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
