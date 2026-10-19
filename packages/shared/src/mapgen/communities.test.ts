import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { GAME_DATA } from '../data/index.js';
import { hexDistance, hexKey, hexSpiral, type Hex } from '../hex/index.js';
import { isTradingPost } from '../territory/reach.js';
import {
  communityCount,
  generateMap,
  mapLayout,
  placeCommunities,
  type CommunityPlacementTile,
  type ExistingCommunity,
  type GeneratedMap,
  type PlacedCommunity,
} from './index.js';

const rules = GAME_DATA.mapGen.communities;
const { gapTerrain } = GAME_DATA.mapGen;
const PLAYER_COUNTS = [2, 3, 4, 6] as const;
const SEEDS = Array.from({ length: 60 }, (_, i) => `villages-${i}`);
const squareApart = rules.ringsApart + 2;

const near = (from: Hex, to: readonly Hex[]) => Math.min(...to.map((h) => hexDistance(from, h)));
const ringKeys = (c: { square: Hex }) => hexSpiral(c.square, 1).map(hexKey);

/** Every hard rule one village keeps on its map (the fairness check is separate). */
function expectValidVillage(
  map: Pick<GeneratedMap, 'homes' | 'radius'> & { tiles: readonly CommunityPlacementTile[] },
  village: PlacedCommunity,
  others: readonly (PlacedCommunity | ExistingCommunity)[],
  maxFromSeed = rules.maxFromSeed,
): void {
  const byKey = new Map(map.tiles.map((t) => [hexKey(t), t]));
  const posts = map.tiles.filter(isTradingPost);
  const ring = ringKeys(village);
  // The whole ring on the map and clear of the Gap, lakes, posts and homes.
  for (const key of ring) {
    const tile = byKey.get(key);
    expect(tile).toBeDefined();
    expect(tile!.terrain).not.toBe(gapTerrain);
    expect(rules.excludedTerrains).not.toContain(tile!.terrain);
    expect(isTradingPost(tile!)).toBe(false);
    expect(tile!.homeSlot).toBeNull();
  }
  // Square first, then 3–6 neighbours in (q, r) order, all free wild land.
  expect(village.tiles[0]).toEqual(village.square);
  expect(village.tiles.length).toBeGreaterThanOrEqual(rules.size.min);
  expect(village.tiles.length).toBeLessThanOrEqual(rules.size.max);
  const rest = village.tiles.slice(1);
  expect(rest).toEqual([...rest].sort((a, b) => a.q - b.q || a.r - b.r));
  expect(new Set(village.tiles.map(hexKey)).size).toBe(village.tiles.length);
  for (const t of village.tiles) {
    expect(ring).toContain(hexKey(t));
    expect(byKey.get(hexKey(t))!.ownerUserId ?? null).toBeNull();
  }
  // Distances: from homes, from posts, from other villages.
  const fromSeed = near(village.square, map.homes);
  expect(fromSeed).toBeGreaterThanOrEqual(rules.minFromSeed);
  expect(fromSeed).toBeLessThanOrEqual(maxFromSeed);
  if (posts.length > 0) {
    expect(near(village.square, posts)).toBeGreaterThanOrEqual(rules.ringFromPost + 1);
  }
  for (const o of others) {
    if (o === village) continue;
    expect(hexDistance(o.square, village.square)).toBeGreaterThanOrEqual(squareApart);
  }
  // The cellar key: outside every ring, a few steps from its own village.
  const key = byKey.get(hexKey(village.keyTile));
  expect(key).toBeDefined();
  expect(key!.terrain).not.toBe(gapTerrain);
  expect(rules.excludedTerrains).not.toContain(key!.terrain);
  expect(isTradingPost(key!)).toBe(false);
  expect(key!.homeSlot).toBeNull();
  for (const o of others) expect(ringKeys(o)).not.toContain(hexKey(village.keyTile));
  const steps = near(village.keyTile, village.tiles);
  expect(steps).toBeGreaterThanOrEqual(rules.keyFromVillage.min);
  expect(steps).toBeLessThanOrEqual(rules.keyFromVillage.max);
}

/** Every home's nearest village square, by slot. */
const nearestOf = (homes: readonly Hex[], villages: readonly { square: Hex }[]) =>
  homes.map((h) =>
    near(
      h,
      villages.map((v) => v.square),
    ),
  );

describe('communityCount (#306)', () => {
  it('is one per 2 seats, rounded up, and at least 2', () => {
    expect([2, 3, 4, 5, 6].map((n) => communityCount(n, rules))).toEqual([2, 3, 2, 3, 3]);
  });
});

describe('villages at mapgen (#306)', () => {
  const maps = PLAYER_COUNTS.map((n) => ({
    n,
    maps: SEEDS.map((seed) => generateMap(GAME_DATA, { seed, playerCount: n })),
  }));

  it('keeps every hard rule on 60 seeds of every layout', () => {
    for (const { n, maps: all } of maps) {
      const { radius } = mapLayout(GAME_DATA, n);
      for (const map of all) {
        expect(map.communities).toHaveLength(communityCount(n, rules));
        for (const v of map.communities) expectValidVillage(map, v, map.communities);
        expect(map.radius).toBe(radius);
        // Distinct key tiles, at least one Lantern Tower, distinct short kind names.
        const keys = map.communities.map((v) => hexKey(v.keyTile));
        expect(new Set(keys).size).toBe(keys.length);
        const kinds = map.communities.map((v) => v.kind);
        expect(kinds).toContain(rules.requiredKind);
        expect(new Set(kinds).size).toBe(kinds.length);
        const names = map.communities.map((v) => v.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
          expect(name.length).toBeLessThanOrEqual(16);
          expect(name.endsWith(` ${rules.nameSuffix}`)).toBe(true);
          expect(findAvoidedWords(name)).toEqual([]);
        }
      }
    }
  }, 30_000);

  it('is fair: the homes’ nearest villages are as near as the land allows', () => {
    // How many maps' homes have their nearest village equally near, or one
    // step apart. 2 and 6 seats almost always do. 4 seats share 2 villages
    // between homes 10 steps apart, so only the midpoint tiles fit and a post
    // or lake there pushes one home further. 3 seats get one village each
    // (owner decision 2026-10-19), since their homes are too far apart to
    // share. A deliberate change to the rule changes these.
    const fair = new Map<number, number>();
    for (const { n, maps: all } of maps) {
      for (const map of all) {
        const nearest = nearestOf(map.homes, map.communities);
        const spread = Math.max(...nearest) - Math.min(...nearest);
        if (spread <= 1) fair.set(n, (fair.get(n) ?? 0) + 1);
        // Every home has a village, never nearer than minFromSeed, never past 2× max.
        for (const d of nearest) {
          expect(d).toBeGreaterThanOrEqual(rules.minFromSeed);
          expect(d).toBeLessThanOrEqual(2 * rules.maxFromSeed);
        }
        expect(spread).toBeLessThanOrEqual(3);
      }
    }
    expect(fair.get(2)).toBe(SEEDS.length);
    expect(fair.get(3)).toBeGreaterThanOrEqual(55);
    expect(fair.get(4)).toBeGreaterThanOrEqual(45);
    expect(fair.get(6)).toBeGreaterThanOrEqual(55);
  }, 30_000);

  it('relaxes the distance on a lake-heavy map rather than fail', () => {
    // 'posts-98': the first home's side is mostly lake (about 1 map in 1000).
    const map = generateMap(GAME_DATA, { seed: 'posts-98', playerCount: 2 });
    expect(map.communities).toHaveLength(2);
    for (const v of map.communities) {
      expectValidVillage(map, v, map.communities, rules.relaxedMaxFromSeed);
    }
  });

  it('is deterministic', () => {
    for (const n of PLAYER_COUNTS) {
      const a = generateMap(GAME_DATA, { seed: 'same', playerCount: n });
      const b = generateMap(GAME_DATA, { seed: 'same', playerCount: n });
      expect(a.communities).toEqual(b.communities);
    }
  });

  it('is the same rule on stored tiles, whatever order they come in', () => {
    const map = generateMap(GAME_DATA, { seed: 'stored', playerCount: 6 });
    const byQr = [...map.tiles].sort((a, b) => a.q - b.q || a.r - b.r);
    for (const tiles of [byQr, [...byQr].reverse()]) {
      expect(
        placeCommunities({ tiles, homes: map.homes, gapTerrain, rules, seed: 'stored' }),
      ).toEqual(map.communities);
    }
  });
});

describe('placeCommunities on an older map (#306 boot pass)', () => {
  const map = generateMap(GAME_DATA, { seed: 'older-villages', playerCount: 6 });
  const home = map.homes[0]!;
  // Two years of play: a kid owns everything within 4 steps of the first
  // Heart Seed, and a building or gatherer keeps some wild tiles busy.
  const played: CommunityPlacementTile[] = map.tiles.map((t) => {
    if (t.homeSlot !== null) return t;
    if (hexDistance(t, home) <= 4) return { ...t, ownerUserId: 'kid-0' };
    if ((t.q * 7 + t.r * 3) % 11 === 0) return { ...t, ownerUserId: 'busy' };
    return t;
  });
  const place = (extra: Partial<Parameters<typeof placeCommunities>[0]> = {}) =>
    placeCommunities({
      tiles: played,
      homes: map.homes,
      gapTerrain,
      rules,
      seed: 'older-villages',
      ...extra,
    });

  it('never builds a village on owned or busy land', () => {
    const villages = place();
    expect(villages).toHaveLength(communityCount(6, rules));
    let grounds = 0;
    for (const v of villages!) {
      // Owned grounds are fine (they stay their owner's); village tiles never are.
      grounds += played.filter(
        (t) => hexDistance(t, v.square) === 1 && t.ownerUserId != null,
      ).length;
      expectValidVillage({ ...map, tiles: played }, v, villages!);
    }
    expect(grounds).toBeGreaterThan(0);
  });

  it('back-fills only the missing villages, around the ones already there', () => {
    const [kept] = map.communities;
    const existing: ExistingCommunity[] = [{ ...kept!, kind: 'bakery' }];
    const villages = place({ existing, partial: true })!;
    expect(villages.length).toBeGreaterThan(0);
    expect(villages.length).toBeLessThanOrEqual(communityCount(6, rules) - 1);
    const all = [...existing, ...villages];
    for (const v of villages) {
      expectValidVillage({ ...map, tiles: played }, v, all);
      expect(hexKey(v.keyTile)).not.toBe(hexKey(kept!.keyTile));
    }
    // The map still gets its Lantern Tower, and no name twice.
    expect(villages.map((v) => v.kind)).toContain(rules.requiredKind);
    expect(new Set(all.map((v) => v.name)).size).toBe(all.length);
  });

  it('adds nothing when the map already has its villages', () => {
    expect(
      placeCommunities({
        tiles: map.tiles,
        homes: map.homes,
        gapTerrain,
        rules,
        seed: 'x',
        existing: map.communities,
      }),
    ).toEqual([]);
  });

  it('keeps a fair layout fair around the villages already there', () => {
    const [kept, ...rest] = map.communities;
    const villages = placeCommunities({
      tiles: map.tiles,
      homes: map.homes,
      gapTerrain,
      rules,
      seed: 'older-villages',
      existing: [kept!],
    })!;
    expect(villages).toHaveLength(rest.length);
    const all = [kept!, ...villages];
    const nearest = nearestOf(map.homes, all);
    const before = nearestOf(map.homes, map.communities);
    expect(Math.max(...nearest) - Math.min(...nearest)).toBeLessThanOrEqual(
      Math.max(1, Math.max(...before) - Math.min(...before)),
    );
  });

  it('gives up (null) when no fair layout fits, and partial places what fits', () => {
    // Everything near the first three homes is taken.
    const crowded: CommunityPlacementTile[] = map.tiles.map((t) =>
      t.homeSlot === null && map.homes.slice(0, 3).some((h) => hexDistance(h, t) <= 7)
        ? { ...t, ownerUserId: 'someone' }
        : t,
    );
    const input = { tiles: crowded, homes: map.homes, gapTerrain, rules, seed: 'crowded' };
    expect(placeCommunities(input)).toBeNull();
    const some = placeCommunities({ ...input, partial: true })!;
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThanOrEqual(communityCount(6, rules));
    for (const v of some) expectValidVillage({ ...map, tiles: crowded }, v, some);
    expect(placeCommunities({ ...input, partial: true })).toEqual(some);
  });

  it('is null, even partial, when there is no room at all', () => {
    const full = map.tiles.map((t) => (t.homeSlot === null ? { ...t, ownerUserId: 'kid' } : t));
    const input = { tiles: full, homes: map.homes, gapTerrain, rules, seed: 'full' };
    expect(placeCommunities(input)).toBeNull();
    expect(placeCommunities({ ...input, partial: true })).toBeNull();
  });
});
