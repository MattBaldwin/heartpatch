import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { CELLAR_RULES } from '../data/server/cellar.js';
import { TERRITORY_RULES } from '../data/territory.js';
import { hex, hexBfs, hexDistance, hexKey, hexNeighbors, hexRing, type Hex } from '../hex/index.js';
import { patchRules } from '../patch-types/index.js';
import { hashString } from '../rng/index.js';
import { landRadius, MapGenSettingsSchema } from '../schemas/data/map-gen.js';
import { isWater } from '../schemas/data/terrains.js';
import { isTradingPost } from '../territory/reach.js';
import { generateMap, landShares, type GeneratedMap, type MapTile } from './index.js';

const rules = GAME_DATA.mapGen.wildIsle!;
const layout = rules.layouts[0]!;
const coastRadius = layout.radius - layout.oceanRings;
const landR = landRadius(rules, layout);
const center = hex(0, 0);
const terrainById = new Map(GAME_DATA.terrains.map((t) => [t.id, t]));
const water = (t: MapTile | undefined) => t !== undefined && isWater(terrainById.get(t.terrain));
const generate = (seed: string) =>
  generateMap(GAME_DATA, {
    seed,
    playerCount: 6,
    cellarKeys: CELLAR_RULES.keyFromVillage,
    patchType: 'wild-isle',
  });
// Plan revision 1 asks for 200 seeds: every rule below holds on each (the
// sea-to-sea rivers were also swept over 500 seeds with no failures).
const SEEDS = Array.from({ length: 200 }, (_, i) => `wild-isle-${i}`);
const maps = SEEDS.map(generate);

const byKeyOf = (map: GeneratedMap) => new Map(map.tiles.map((t) => [hexKey(t), t]));
/** Main-island land: what kids can walk on (isles and water aren't). */
const landOf = (map: GeneratedMap) => {
  const byKey = byKeyOf(map);
  return (h: Hex) => {
    const t = byKey.get(hexKey(h));
    return t !== undefined && t.isle === undefined && !water(t);
  };
};
/** Connected groups of tiles of the given terrains. */
function bodies(map: GeneratedMap, terrains: readonly string[]): Hex[][] {
  const byKey = byKeyOf(map);
  const seen = new Set<string>();
  const out: Hex[][] = [];
  for (const t of map.tiles) {
    if (!terrains.includes(t.terrain) || seen.has(hexKey(t))) continue;
    const reached = hexBfs([t], (h) => terrains.includes(byKey.get(hexKey(h))?.terrain ?? ''));
    const body = [...reached.keys()].map((k) => byKey.get(k)!);
    for (const h of body) seen.add(hexKey(h));
    out.push(body);
  }
  return out;
}

describe('generateMap: Wild Isle', () => {
  it('gives an identical island for the same seed, and different ones for different seeds', () => {
    expect(generate('a')).toEqual(generate('a'));
    const looks = new Set(maps.slice(0, 20).map((m) => m.tiles.map((t) => t.terrain).join()));
    expect(looks.size).toBe(20);
  });

  it('pins the output for a known seed, so generator changes are deliberate', () => {
    // Tiles are stored, so a change only moves islands not made yet: update
    // the hash on purpose.
    expect(hashString(JSON.stringify(generate('pinned-seed')))).toBe(
      '600ca124daf728e5d30243afad5dbc8b',
    );
  });

  it('leaves Cozy Patches to the Cozy generator', () => {
    const cozy = { seed: 'pinned-seed', playerCount: 6 } as const;
    expect(generateMap(GAME_DATA, { ...cozy, patchType: 'cozy' })).toEqual(
      generateMap(GAME_DATA, cozy),
    );
    expect(generateMap(GAME_DATA, cozy).tiles.some((t) => t.isle !== undefined)).toBe(false);
  });

  it('refuses a seat count with no layout, and data with no Wild Isle block', () => {
    expect(() =>
      generateMap(GAME_DATA, { seed: 'a', playerCount: 4, patchType: 'wild-isle' }),
    ).toThrow(RangeError);
    const cozyOnly = { ...GAME_DATA.mapGen, wildIsle: undefined };
    expect(() =>
      generateMap(
        { ...GAME_DATA, mapGen: cozyOnly },
        { seed: 'a', playerCount: 6, patchType: 'wild-isle' },
      ),
    ).toThrow(RangeError);
  });

  it('keeps the data valid and its water clear of the never-fade ring', () => {
    expect(MapGenSettingsSchema.safeParse(GAME_DATA.mapGen).success).toBe(true);
    expect(rules.waterMinFromSeed).toBeGreaterThan(TERRITORY_RULES.tending.keepRadius);
  });

  it('places only Wild Isle terrains: never Cozy’s claimable lake', () => {
    const allowed = new Set(patchRules('wild-isle').terrains.map((t) => t.id));
    for (const map of maps) {
      for (const t of map.tiles) expect(allowed.has(t.terrain), t.terrain).toBe(true);
    }
  });

  it('rings the island with coast and the coast with sea', () => {
    for (const map of maps) {
      const byKey = byKeyOf(map);
      expect(map.radius).toBe(layout.radius);
      expect(map.tiles).toHaveLength(1 + 3 * layout.radius * (layout.radius + 1));
      const wrong = map.tiles.filter((t) => {
        if (t.isle !== undefined) return false;
        const ring = hexDistance(t, center);
        const touchesSea = hexNeighbors(t).some(
          (n) => byKey.get(hexKey(n))?.terrain === rules.oceanTerrain,
        );
        // A river's mouth or a trading post may stand on the coast.
        if (ring > coastRadius) return t.terrain !== rules.oceanTerrain;
        if (ring > landR) {
          return ![rules.coastTerrain, rules.riverTerrain].includes(t.terrain) && !isTradingPost(t);
        }
        return [rules.oceanTerrain, rules.coastTerrain].includes(t.terrain) || touchesSea;
      });
      expect(wrong).toEqual([]);
    }
  });

  it('runs every river sea to sea, one per pair of homes, clear of homes and the Gap', () => {
    for (const map of maps) {
      const byKey = byKeyOf(map);
      const rivers = bodies(map, [rules.riverTerrain, rules.lakeTerrain]).filter((b) =>
        b.some((h) => byKey.get(hexKey(h))!.terrain === rules.riverTerrain),
      );
      // Six homes, three rivers (owner decision 2026-11-01). Only the 6-seat
      // layout exists; another layout groups homes differently (`riverGroups`).
      expect(rivers).toHaveLength(map.homes.length / 2);
      for (const river of rivers) {
        // Two mouths on opposite sides: coast tiles that touch the sea, far apart.
        const mouths = river.filter((h) =>
          hexNeighbors(h).some((n) => byKey.get(hexKey(n))?.terrain === rules.oceanTerrain),
        );
        const [a, ...rest] = mouths;
        expect(rest.length).toBeGreaterThanOrEqual(1);
        expect(Math.max(...rest.map((m) => hexDistance(a!, m)))).toBeGreaterThanOrEqual(
          coastRadius,
        );
        // It crosses the middle, never running along the coast: past the
        // land's edge only at its two mouths (the coast tile and the step in).
        const byCoast = river.filter(
          (h) =>
            byKey.get(hexKey(h))!.terrain === rules.riverTerrain && hexDistance(h, center) >= landR,
        );
        expect(byCoast.length).toBeLessThanOrEqual(4);
      }
      for (const t of map.tiles) {
        if (!water(t) || t.terrain === rules.oceanTerrain) continue;
        expect(t.homeSlot).toBeNull();
        expect(Math.min(...map.homes.map((h) => hexDistance(h, t)))).toBeGreaterThanOrEqual(
          rules.waterMinFromSeed,
        );
        expect(hexDistance(t, center)).toBeGreaterThan(GAME_DATA.mapGen.gapRadius + 1);
      }
    }
  });

  it('splits the island: each river is a wall until someone builds a bridge', () => {
    for (const map of maps) {
      const isLand = landOf(map);
      const land = map.tiles.filter(isLand);
      const seen = new Set<string>();
      const homeKeys = new Set(map.homes.map(hexKey));
      let pieces = 0;
      for (const t of land) {
        if (seen.has(hexKey(t))) continue;
        const piece = [...hexBfs([t], isLand).keys()];
        for (const k of piece) seen.add(k);
        pieces++;
        // No pockets: a piece with no home is a real place to bridge to.
        if (!piece.some((k) => homeKeys.has(k))) {
          expect(piece.length).toBeGreaterThanOrEqual(rules.minPieceLand);
        }
      }
      // Rivers keep `apart` steps from each other, so no piece between two is a sliver.
      const byKey = byKeyOf(map);
      const riverBodies = bodies(map, [rules.riverTerrain, rules.lakeTerrain]).filter((b) =>
        b.some((h) => byKey.get(hexKey(h))!.terrain === rules.riverTerrain),
      );
      riverBodies.forEach((a, i) => {
        for (const b of riverBodies.slice(i + 1)) {
          const rivers = (body: Hex[]) =>
            body.filter((h) => byKey.get(hexKey(h))!.terrain === rules.riverTerrain);
          const closest = Math.min(
            ...rivers(a).flatMap((h) => rivers(b).map((k) => hexDistance(h, k))),
          );
          expect(closest).toBeGreaterThanOrEqual(rules.rivers.apart);
        }
      });
      // Three rivers that never cross cut the island into at least four pieces.
      expect(pieces).toBeGreaterThanOrEqual(map.homes.length / 2 + 1);
      // A home's never-fade ring is all on its own piece, with its Heart Seed.
      for (const home of map.homes) {
        const region = hexBfs([home], isLand);
        for (const h of land.filter((t) => hexDistance(t, home) < rules.waterMinFromSeed)) {
          expect(region.has(hexKey(h))).toBe(true);
        }
      }
    }
  });

  it('gives every home a river within reach', () => {
    for (const map of maps) {
      const byKey = byKeyOf(map);
      for (const home of map.homes) {
        const near = map.tiles.some(
          (t) => t.terrain === rules.riverTerrain && hexDistance(t, home) <= rules.homeWaterSteps,
        );
        expect(near).toBe(true);
        expect(byKey.get(hexKey(home))!.terrain).toBe(GAME_DATA.mapGen.homeTerrain);
      }
    }
  });

  it('makes lakes of the right size, each with room for a ferry dock', () => {
    for (const map of maps) {
      const byKey = byKeyOf(map);
      const lakes = bodies(map, [rules.lakeTerrain]);
      expect(lakes.length).toBeGreaterThanOrEqual(rules.lakes.count[0]);
      expect(lakes.length).toBeLessThanOrEqual(rules.lakes.count[1]);
      for (const lake of lakes) {
        // A river lake also swallows the river tiles it grew over.
        expect(lake.length).toBeLessThanOrEqual(rules.lakes.size[1]);
        const shore = new Set(
          lake.flatMap((h) =>
            hexNeighbors(h)
              .map((n) => byKey.get(hexKey(n)))
              .filter((n): n is MapTile => n !== undefined && !water(n) && n.homeSlot === null)
              .map(hexKey),
          ),
        );
        expect(shore.size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps water free of nodes and guardians', () => {
    for (const map of maps) {
      for (const t of map.tiles.filter(water)) {
        expect(t.nodeResource).toBeNull();
        expect(t.guardianStrength).toBeNull();
      }
    }
  });

  it('gives every home enough land, a fair share of it, and a trading post on it', () => {
    for (const map of maps) {
      const isLand = landOf(map);
      const posts = map.tiles.filter(isTradingPost);
      expect(posts.length).toBe(map.homes.length);
      for (const home of map.homes) {
        const region = hexBfs([home], isLand);
        expect(region.size).toBeGreaterThanOrEqual(rules.minRegionLand);
        expect(posts.some((p) => region.has(hexKey(p)))).toBe(true);
      }
      const shares = landShares(map.homes, map.tiles.filter(isLand));
      const average = shares.reduce((a, b) => a + b, 0) / shares.length;
      for (const share of shares) {
        expect(Math.abs(share - average) / average).toBeLessThanOrEqual(
          rules.landBandPercent / 100,
        );
      }
      expect(map.communities.length).toBeGreaterThanOrEqual(GAME_DATA.mapGen.communities.minPerMap);
      for (const c of map.communities) for (const h of c.tiles) expect(isLand(h)).toBe(true);
    }
  });

  it('puts the isles out at sea where nobody can walk', () => {
    for (const map of maps) {
      const isLand = landOf(map);
      const reached = hexBfs(map.homes, isLand);
      const isles = new Map<number, MapTile[]>();
      for (const t of map.tiles) {
        if (t.isle === undefined) continue;
        isles.set(t.isle, [...(isles.get(t.isle) ?? []), t]);
        expect(reached.has(hexKey(t))).toBe(false);
        expect(water(t)).toBe(false);
        expect(hexDistance(t, center)).toBe(coastRadius + rules.isles.offshore + 1);
      }
      expect(isles.size).toBeGreaterThanOrEqual(rules.isles.count[0]);
      expect(isles.size).toBeLessThanOrEqual(rules.isles.count[1]);
      expect([...isles.keys()].sort()).toEqual(Array.from({ length: isles.size }, (_, i) => i + 1));
      for (const tiles of isles.values()) {
        expect(tiles.length).toBeGreaterThanOrEqual(rules.isles.size[0]);
        expect(tiles.length).toBeLessThanOrEqual(rules.isles.size[1]);
      }
    }
  });

  it('keeps the terrain mix in its bands', () => {
    // About 1027 tiles: 222 sea, 96 coast, the rest land with some water
    // (three sea-to-sea rivers are about 25 tiles each, plus the lakes).
    const ringTiles = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => hexRing(center, from + i).length).reduce(
        (a, b) => a + b,
        0,
      );
    for (const map of maps) {
      const count = (id: string) => map.tiles.filter((t) => t.terrain === id).length;
      const isles = map.tiles.filter((t) => t.isle !== undefined).length;
      expect(count(rules.oceanTerrain)).toBe(ringTiles(coastRadius + 1, layout.radius) - isles);
      const land = map.tiles.filter(landOf(map)).length;
      expect(land).toBeGreaterThanOrEqual(680);
      expect(land).toBeLessThanOrEqual(760);
      expect(count(rules.riverTerrain) + count(rules.lakeTerrain)).toBeGreaterThanOrEqual(70);
      expect(count(rules.riverTerrain) + count(rules.lakeTerrain)).toBeLessThanOrEqual(140);
    }
  });
});
