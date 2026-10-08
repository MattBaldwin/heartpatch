import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { hex, hexDistance, hexKey } from '../hex/index.js';
import { TRADING_POST_TERRAIN, isTradingPost } from '../territory/reach.js';
import {
  generateMap,
  mapLayout,
  placeTradingPosts,
  tradingPostLabels,
  type PostPlacementTile,
} from './index.js';

const rules = GAME_DATA.mapGen.tradingPosts;
const PLAYER_COUNTS = [2, 3, 4] as const;
const SEEDS = Array.from({ length: 200 }, (_, i) => `posts-${i}`);

const postsOf = (tiles: readonly { q: number; r: number; terrain: string }[]) =>
  tiles.filter(isTradingPost);

describe('trading posts at mapgen (#269)', () => {
  it('pins where the posts go for a known seed, for every layout', () => {
    // A deliberate change to the rule changes these.
    const pinned = PLAYER_COUNTS.map((n) =>
      postsOf(generateMap(GAME_DATA, { seed: 'pinned-seed', playerCount: n }).tiles)
        .map(hexKey)
        .join(' '),
    );
    expect(pinned).toEqual([
      '-1,-2 -6,8 9,-4 -9,4',
      '-7,0 8,2 2,-10 -10,8',
      '4,7 11,-9 -4,-7 -11,8',
    ]);
  });

  // 600 whole maps: about 5 s under CI's coverage run, so more than the 5 s default.
  it('keeps the hard rules and the fairness check on 200 seeds of every layout', () => {
    for (const n of PLAYER_COUNTS) {
      const { radius } = mapLayout(GAME_DATA, n);
      for (const seed of SEEDS) {
        const map = generateMap(GAME_DATA, { seed, playerCount: n });
        const posts = postsOf(map.tiles);
        expect(posts).toHaveLength(rules.perMap);
        for (const p of posts) {
          const fromSeeds = map.homes.map((h) => hexDistance(h, p));
          // Near some home, never touching one, never in the Gap or off the map.
          expect(Math.min(...fromSeeds)).toBeGreaterThanOrEqual(rules.minFromSeed);
          expect(Math.min(...fromSeeds)).toBeLessThanOrEqual(rules.maxFromSeed);
          expect(hexDistance(p, hex(0, 0))).toBeGreaterThan(GAME_DATA.mapGen.gapRadius);
          expect(hexDistance(p, hex(0, 0))).toBeLessThanOrEqual(radius);
          for (const o of posts)
            if (o !== p) expect(hexDistance(p, o)).toBeGreaterThanOrEqual(rules.minApart);
        }
        // Every home slot has one within N, and every home is as near as the next.
        const nearest = map.homes.map((h) => Math.min(...posts.map((p) => hexDistance(h, p))));
        for (const d of nearest) expect(d).toBeLessThanOrEqual(rules.maxFromSeed);
        expect(Math.max(...nearest) - Math.min(...nearest)).toBeLessThanOrEqual(1);
      }
    }
  }, 30_000);

  it('makes post tiles neutral with no node and no guardians', () => {
    for (const n of PLAYER_COUNTS) {
      for (const post of postsOf(generateMap(GAME_DATA, { seed: 'a', playerCount: n }).tiles)) {
        expect(post).toMatchObject({
          terrain: TRADING_POST_TERRAIN,
          homeSlot: null,
          nodeResource: null,
          guardianStrength: null,
        });
      }
    }
  });

  it('is the same rule on stored tiles, whatever order they come in', () => {
    const map = generateMap(GAME_DATA, { seed: 'stored', playerCount: 3 });
    // Turn the posts back into meadow, as an older map would be, and place
    // again from tiles in the server's (q, r) order and in reverse.
    const older = map.tiles.map((t) => (isTradingPost(t) ? { ...t, terrain: 'meadow' } : t));
    const byQr = [...older].sort((a, b) => a.q - b.q || a.r - b.r);
    const expected = postsOf(map.tiles)
      .map(hexKey)
      .sort((a, b) => (a < b ? -1 : 1));
    for (const tiles of [byQr, [...byQr].reverse()]) {
      const again = placeTradingPosts({
        tiles,
        homes: map.homes,
        gapTerrain: GAME_DATA.mapGen.gapTerrain,
        rules,
        seed: 'stored',
      });
      expect(again?.map(hexKey).sort((a, b) => (a < b ? -1 : 1))).toEqual(expected);
    }
  });
});

describe('placeTradingPosts on an older map (#269 boot pass)', () => {
  const map = generateMap(GAME_DATA, { seed: 'older', playerCount: 4 });
  const older = map.tiles.map((t) => (isTradingPost(t) ? { ...t, terrain: 'meadow' } : t));
  const place = (tiles: readonly PostPlacementTile[]) =>
    placeTradingPosts({
      tiles,
      homes: map.homes,
      gapTerrain: GAME_DATA.mapGen.gapTerrain,
      rules,
      seed: 'older',
    });

  it('never takes owned land', () => {
    // Someone has claimed every tile 3 steps from the first Heart Seed.
    const home = map.homes[0]!;
    const claimed: PostPlacementTile[] = older.map((t) =>
      hexDistance(t, home) === 3 ? { ...t, ownerUserId: 'someone' } : t,
    );
    const posts = place(claimed)!;
    expect(posts).toHaveLength(rules.perMap);
    const owned = new Set(claimed.filter((t) => t.ownerUserId != null).map(hexKey));
    for (const p of posts) expect(owned.has(hexKey(p))).toBe(false);
    // Still fair: the homes' nearest posts are at most a step apart.
    const nearest = map.homes.map((h) => Math.min(...posts.map((p) => hexDistance(h, p))));
    expect(Math.max(...nearest) - Math.min(...nearest)).toBeLessThanOrEqual(1);
  });

  it('gives up (null) when there is no fair spot free, rather than take land', () => {
    const home = map.homes[0]!;
    const claimed: PostPlacementTile[] = older.map((t) =>
      hexDistance(t, home) <= rules.maxFromSeed && t.homeSlot === null
        ? { ...t, ownerUserId: 'someone' }
        : t,
    );
    expect(place(claimed)).toBeNull();
  });

  it('never picks a home tile or the Gap', () => {
    for (const p of place(older)!) {
      const tile = older.find((t) => t.q === p.q && t.r === p.r)!;
      expect(tile.homeSlot).toBeNull();
      expect(tile.terrain).not.toBe(GAME_DATA.mapGen.gapTerrain);
    }
  });
});

describe('tradingPostLabels', () => {
  it('names each post by its place in (q, r) order', () => {
    const tiles = [
      { q: 2, r: 0, terrain: TRADING_POST_TERRAIN },
      { q: 0, r: 1, terrain: 'meadow' },
      { q: -3, r: 1, terrain: TRADING_POST_TERRAIN },
    ];
    const labels = tradingPostLabels(tiles, rules);
    expect(labels.get('-3,1')).toEqual({ index: 0, name: rules.names[0] });
    expect(labels.get('2,0')).toEqual({ index: 1, name: rules.names[1] });
    expect(labels.has('0,1')).toBe(false);
  });
});
