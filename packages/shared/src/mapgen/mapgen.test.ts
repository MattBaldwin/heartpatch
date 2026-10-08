import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { hashString } from '../rng/index.js';
import { hex, hexDistance, hexKey, hexRing, hexSpiral } from '../hex/index.js';
import { terrainNodeResources } from '../schemas/data/terrains.js';
import {
  extraNodes,
  generateMap,
  generateMapBeforePosts,
  homeShares,
  mapLayout,
  type GeneratedMap,
  type MapGenData,
} from './index.js';

const { mapGen } = GAME_DATA;
const PLAYER_COUNTS = [2, 3, 4] as const;
const SEEDS = Array.from({ length: 60 }, (_, i) => `test-map-${i}`);
const center = hex(0, 0);

const generate = (seed: string, playerCount: number, data: MapGenData = GAME_DATA) =>
  generateMap(data, { seed, playerCount });

/** Every map we test against: each player count × many seeds. */
const maps: GeneratedMap[] = PLAYER_COUNTS.flatMap((n) => SEEDS.map((seed) => generate(seed, n)));

const terrainById = new Map(GAME_DATA.terrains.map((t) => [t.id, t]));

describe('generateMap: determinism', () => {
  it('gives an identical map for the same seed', () => {
    for (const n of PLAYER_COUNTS) {
      for (const seed of ['a', 'heartpatch', SEEDS[7]!]) {
        expect(generate(seed, n)).toEqual(generate(seed, n));
      }
    }
  });

  it('gives different maps for different seeds', () => {
    for (const n of PLAYER_COUNTS) {
      const terrains = new Set(
        SEEDS.slice(0, 10).map((seed) =>
          generate(seed, n)
            .tiles.map((t) => t.terrain)
            .join(),
        ),
      );
      expect(terrains.size).toBe(10);
    }
  });

  it('pins the output for a known seed, so generator changes are deliberate', () => {
    // If this fails, the generator changed: existing seeds now make different
    // maps. That's fine for maps not created yet (tiles are persisted), so
    // update the hash on purpose. Changed once on purpose by #269's trading
    // posts; the passes before them are pinned just below, unchanged.
    expect(hashString(JSON.stringify(generate('pinned-seed', 4)))).toBe(
      '58d1d50f837ac7ed09788b3db5492ff2',
    );
    expect(
      hashString(
        JSON.stringify(generateMapBeforePosts(GAME_DATA, { seed: 'pinned-seed', playerCount: 4 })),
      ),
    ).toBe('6b17966c98f2a81970687e78ad3b2d9b');
  });

  it('keeps the main pass as it was before the extra nodes (#238)', () => {
    // Without the extra pass's nodes, the map is the one main made before
    // #238 (its pinned hash then), so no stored map's nodes move.
    const map = generateMapBeforePosts(GAME_DATA, { seed: 'pinned-seed', playerCount: 4 });
    expect(hashString(JSON.stringify({ ...map, tiles: withoutExtras(map) }))).toBe(
      '4d809aead0d653d4c4a31c5db548d8b6',
    );
  });
});

/** The map's tiles with the extra pass's nodes (#238) taken off again. */
function withoutExtras(map: GeneratedMap): GeneratedMap['tiles'] {
  const extraIds = new Set(
    GAME_DATA.terrains.flatMap((t) => (t.extraNodes ?? []).map((e) => `${t.id}:${e.resource}`)),
  );
  return map.tiles.map((t) =>
    t.homeSlot === null &&
    extraIds.has(`${t.terrain}:${String(t.nodeResource)}`) &&
    !GAME_DATA.terrains.find((x) => x.id === t.terrain)!.nodeResources.includes(t.nodeResource!)
      ? { ...t, nodeResource: null }
      : t,
  );
}

describe('extraNodes (#238: Water, Greens and Ice)', () => {
  const map = generate('extra-seed', 4);
  const old = { ...map, tiles: withoutExtras(map) };

  it('gives an older map, read later, exactly the nodes a new map is made with', () => {
    const added = new Map(
      extraNodes(old.tiles, GAME_DATA.terrains, 'extra-seed').map((n) => [hexKey(n), n.resource]),
    );
    const backfilled = old.tiles.map((t) => ({
      ...t,
      nodeResource: added.get(hexKey(t)) ?? t.nodeResource,
    }));
    expect(backfilled).toEqual(map.tiles);
    expect(added.size).toBeGreaterThan(0);
  });

  it('adds nothing twice, and never to home tiles or tiles with a node', () => {
    expect(extraNodes(map.tiles, GAME_DATA.terrains, 'extra-seed')).toEqual([]);
    const added = extraNodes(old.tiles, GAME_DATA.terrains, 'extra-seed');
    const byKey = new Map(old.tiles.map((t) => [hexKey(t), t]));
    for (const n of added) {
      const tile = byKey.get(hexKey(n))!;
      expect(tile.homeSlot).toBeNull();
      expect(tile.nodeResource).toBeNull();
    }
  });

  it('puts a well on every lake, and Greens on some forests, where the data says', () => {
    for (const t of map.tiles) {
      if (t.homeSlot === null && t.terrain === 'lake') expect(t.nodeResource).toBe('water');
    }
    const kinds = new Set(map.tiles.map((t) => `${t.terrain}:${String(t.nodeResource)}`));
    expect(kinds).toContain('forest:greens');
    // The nesting economy (#238): meadows and mountains give theirs to gatherers, no spot.
    expect(kinds).not.toContain('meadow:greens');
    expect(kinds).not.toContain('mountains:ice');
    // A different seed, different forests.
    const other = extraNodes(
      withoutExtras(generate('another-seed', 4)),
      GAME_DATA.terrains,
      'another-seed',
    );
    expect(other).not.toEqual(extraNodes(old.tiles, GAME_DATA.terrains, 'extra-seed'));
  });
});

describe('generateMap: size and shape', () => {
  it('uses the radius for each player count (design doc §3)', () => {
    expect(generate('size', 2).tiles).toHaveLength(271);
    expect(generate('size', 3).tiles).toHaveLength(397);
    expect(generate('size', 4).tiles).toHaveLength(469);
    expect(PLAYER_COUNTS.map((n) => mapLayout(GAME_DATA, n).radius)).toEqual([9, 11, 12]);
  });

  it('covers every hex in the radius exactly once, in spiral order', () => {
    for (const map of maps.slice(0, 5)) {
      expect(map.tiles.map((t) => hexKey(t))).toEqual(
        hexSpiral(center, map.radius).map((h) => hexKey(h)),
      );
    }
  });

  it('rejects player counts with no layout', () => {
    expect(() => generate('size', 1)).toThrow(RangeError);
    expect(() => generate('size', 5)).toThrow(RangeError);
  });
});

describe("generateMap: Juniper's Gap", () => {
  it('fills the centre with the Gap, its richest land and toughest guardians', () => {
    for (const map of maps) {
      expect(map.hollowEntrance).toEqual(center);
      const gap = map.tiles.filter((t) => hexDistance(t, center) <= mapGen.gapRadius);
      expect(gap).toHaveLength(7);
      for (const tile of gap) {
        expect(tile.terrain).toBe('junipers-gap');
        expect(tile.homeSlot).toBeNull();
        expect(tile.nodeResource).not.toBeNull();
        expect(terrainById.get('junipers-gap')!.nodeResources).toContain(tile.nodeResource);
        expect(tile.guardianStrength).toBe(mapGen.guardianStrength.gap);
      }
    }
  });

  it('never puts Gap terrain anywhere else', () => {
    for (const map of maps) {
      for (const tile of map.tiles) {
        if (hexDistance(tile, center) > mapGen.gapRadius)
          expect(tile.terrain).not.toBe('junipers-gap');
      }
    }
  });

  it('can shrink the Gap to a single tile through data', () => {
    const data = { ...GAME_DATA, mapGen: { ...mapGen, gapRadius: 0 } };
    const map = generate('tiny-gap', 2, data);
    expect(map.tiles.filter((t) => t.terrain === 'junipers-gap')).toEqual([
      expect.objectContaining({ q: 0, r: 0 }),
    ]);
  });
});

describe('generateMap: home bases', () => {
  it('places every Heart Seed the same distance from the Gap', () => {
    for (const map of maps) {
      const { homeDistance } = mapLayout(GAME_DATA, map.playerCount);
      expect(map.homes).toHaveLength(map.playerCount);
      for (const home of map.homes) expect(hexDistance(home, center)).toBe(homeDistance);
    }
  });

  it('spaces homes so every player has the same distances to their rivals', () => {
    for (const map of maps) {
      const { homeDistance } = mapLayout(GAME_DATA, map.playerCount);
      const profiles = map.homes.map((a, i) =>
        map.homes
          .filter((_, j) => j !== i)
          .map((b) => hexDistance(a, b))
          .sort((x, y) => x - y)
          .join('/'),
      );
      expect(new Set(profiles).size).toBe(1);
      // Rivals are never closer than the Gap is.
      const nearest = Math.min(...profiles[0]!.split('/').map(Number));
      expect(nearest).toBeGreaterThanOrEqual(homeDistance);
    }
  });

  it('gives every player an equal share of the map', () => {
    for (const map of maps) {
      const shares = homeShares(map.homes, map.tiles);
      expect(new Set(shares).size).toBe(1);
    }
  });

  it('turns the home layout between maps', () => {
    for (const n of PLAYER_COUNTS) {
      const firstHomes = new Set(SEEDS.map((seed) => hexKey(generate(seed, n).homes[0]!)));
      expect(firstHomes.size).toBeGreaterThan(1);
    }
  });

  it('owns each Heart Seed tile and its ring, with no guardians', () => {
    for (const map of maps) {
      const byKey = new Map(map.tiles.map((t) => [hexKey(t), t]));
      map.homes.forEach((home, slot) => {
        for (const h of hexSpiral(home, 1)) {
          const tile = byKey.get(hexKey(h))!;
          expect(tile.homeSlot).toBe(slot);
          expect(tile.guardianStrength).toBeNull();
        }
        expect(byKey.get(hexKey(home))!.terrain).toBe(mapGen.homeTerrain);
        expect(byKey.get(hexKey(home))!.nodeResource).toBeNull();
      });
      expect(map.tiles.filter((t) => t.homeSlot !== null)).toHaveLength(7 * map.playerCount);
    }
  });

  it('guarantees Timber, Stone, Emberwood, a farm plot and the seasonal nodes in every home ring', () => {
    for (const map of maps) {
      const byKey = new Map(map.tiles.map((t) => [hexKey(t), t]));
      for (const home of map.homes) {
        const nodes = hexRing(home, 1)
          .map((h) => byKey.get(hexKey(h))!.nodeResource)
          .filter((r) => r !== null)
          .sort();
        // Decision B, plus Pumpkins and a leaf pile (owner decision 2026-10-06).
        expect(nodes).toEqual([
          'emberwood',
          'magic-fallen-leaves',
          'pumpkins',
          'stone',
          'timber',
          'treats',
        ]);
      }
    }
  });

  it('keeps neutral land between the Gap and every home ring', () => {
    for (const map of maps) {
      for (const home of map.homes) {
        for (const h of hexSpiral(home, 1)) {
          expect(hexDistance(h, center)).toBeGreaterThan(mapGen.gapRadius + 1);
        }
      }
    }
  });
});

describe('generateMap: terrain, nodes and guardians', () => {
  it('only uses known terrain, and scatters every generated terrain somewhere', () => {
    const seen = new Set<string>();
    for (const map of maps) {
      for (const tile of map.tiles) {
        expect(terrainById.has(tile.terrain)).toBe(true);
        seen.add(tile.terrain);
      }
    }
    expect([...seen].sort()).toEqual(GAME_DATA.terrains.map((t) => t.id).sort());
  });

  it('grows terrain in patches, not noise', () => {
    // Most land tiles share terrain with at least one neighbour.
    for (const map of maps.slice(0, 20)) {
      const byKey = new Map(map.tiles.map((t) => [hexKey(t), t]));
      const land = map.tiles.filter((t) => t.homeSlot === null && t.terrain !== 'junipers-gap');
      const clumped = land.filter((t) =>
        hexRing(t, 1).some((h) => byKey.get(hexKey(h))?.terrain === t.terrain),
      );
      expect(clumped.length / land.length).toBeGreaterThan(0.8);
    }
  });

  it("only puts nodes that match the tile's terrain on neutral land", () => {
    for (const map of maps) {
      for (const tile of map.tiles) {
        if (tile.homeSlot !== null || tile.nodeResource === null) continue;
        expect(terrainNodeResources(terrainById.get(tile.terrain)!)).toContain(tile.nodeResource);
      }
    }
  });

  it('gives every neutral tile a guardian slot that gets tougher away from home', () => {
    const { min, max } = mapGen.guardianStrength;
    for (const map of maps) {
      const stepsToHome = (t: { q: number; r: number }) =>
        Math.min(...map.homes.map((h) => hexDistance(h, t)));
      const neutral = map.tiles.filter(
        (t) => t.homeSlot === null && t.terrain !== 'junipers-gap' && t.terrain !== 'trading-post',
      );
      for (const tile of neutral) {
        expect(tile.guardianStrength).toBeGreaterThanOrEqual(min);
        expect(tile.guardianStrength).toBeLessThanOrEqual(max);
        if (stepsToHome(tile) === 2) expect(tile.guardianStrength).toBe(min);
      }
      const sorted = [...neutral].sort((a, b) => stepsToHome(a) - stepsToHome(b));
      sorted.forEach((tile, i) => {
        if (i > 0)
          expect(tile.guardianStrength!).toBeGreaterThanOrEqual(sorted[i - 1]!.guardianStrength!);
      });
    }
  });
});
