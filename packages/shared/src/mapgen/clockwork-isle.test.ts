import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { CELLAR_RULES } from '../data/server/cellar.js';
import { hexBfs, hexKey, hexNeighbors } from '../hex/index.js';
import { patchRules } from '../patch-types/index.js';
import { hashString } from '../rng/index.js';
import { MapGenSettingsSchema } from '../schemas/data/map-gen.js';
import { isWater } from '../schemas/data/terrains.js';
import { isTradingPost } from '../territory/reach.js';
import {
  SCRAP_HEAP_REACH,
  SCRAP_HEAP_RESOURCE,
  WIND_SPLIT,
  generateMap,
  generateWildIsle,
  type GeneratedMap,
  type MapTile,
} from './index.js';

const rules = GAME_DATA.mapGen.clockworkIsle!;
const terrainById = new Map(GAME_DATA.terrains.map((t) => [t.id, t]));
const water = (t: MapTile) => isWater(terrainById.get(t.terrain));
const generate = (seed: string) =>
  generateMap(GAME_DATA, {
    seed,
    playerCount: 6,
    cellarKeys: CELLAR_RULES.keyFromVillage,
    patchType: 'clockwork-isle',
  });
const SEEDS = Array.from({ length: 60 }, (_, i) => `clockwork-isle-${i}`);
const maps = SEEDS.map(generate);
const byKeyOf = (map: GeneratedMap) => new Map(map.tiles.map((t) => [hexKey(t), t]));
const heapsOf = (map: GeneratedMap) =>
  map.tiles.filter((t) => t.nodeResource === SCRAP_HEAP_RESOURCE);

describe('generateMap: Clockwork Isle', () => {
  it('gives an identical isle for the same seed, and different ones for different seeds', () => {
    expect(generate('a')).toEqual(generate('a'));
    const looks = new Set(maps.slice(0, 20).map((m) => m.tiles.map((t) => t.wind ?? 0).join()));
    expect(looks.size).toBe(20);
  });

  it('pins the output for a known seed, so generator changes are deliberate', () => {
    // Tiles are stored, so a change only moves isles not made yet: update
    // the hash on purpose.
    expect(hashString(JSON.stringify(generate('pinned-seed')))).toBe(
      'a0e67d06685d48cf3dc3dce8f6fa8f11',
    );
  });

  it("is the Wild Isle generator's island on `clockworkIsle.island`, plus wind and heaps", () => {
    const options = { seed: 'pinned-seed', playerCount: 6 } as const;
    const island = generateWildIsle(
      { ...GAME_DATA, mapGen: { ...GAME_DATA.mapGen, wildIsle: rules.island } },
      options,
    );
    const isle = generateMap(GAME_DATA, { ...options, patchType: 'clockwork-isle' });
    expect(isle.homes).toEqual(island.homes);
    expect(isle.communities).toEqual(island.communities);
    const bare = (t: MapTile) => {
      const copy: Record<string, unknown> = { ...t };
      delete copy['wind'];
      delete copy['nodeResource'];
      return copy;
    };
    expect(isle.tiles.map(bare)).toEqual(island.tiles.map(bare));
    // Only Scrap Heaps change a node.
    isle.tiles.forEach((t, i) => {
      if (t.nodeResource !== island.tiles[i]!.nodeResource) {
        expect(t.nodeResource).toBe(SCRAP_HEAP_RESOURCE);
      }
    });
  });

  it('refuses a seat count with no layout, and data with no Clockwork Isle block', () => {
    expect(() =>
      generateMap(GAME_DATA, { seed: 'a', playerCount: 4, patchType: 'clockwork-isle' }),
    ).toThrow(RangeError);
    const withoutIt = { ...GAME_DATA.mapGen, clockworkIsle: undefined };
    expect(() =>
      generateMap(
        { ...GAME_DATA, mapGen: withoutIt },
        { seed: 'a', playerCount: 6, patchType: 'clockwork-isle' },
      ),
    ).toThrow(RangeError);
  });

  it('keeps the data valid, with a layout for every seat count the create path makes', () => {
    expect(MapGenSettingsSchema.safeParse(GAME_DATA.mapGen).success).toBe(true);
    // The create path makes every patch with MAP_MAX_PLAYERS (6) seats.
    expect(rules.island.layouts.map((l) => l.players)).toEqual([6]);
    expect(rules.island.layouts[0]!.radius).toBe(18);
  });

  it('places only Clockwork Isle terrains, and no offshore isles', () => {
    const allowed = new Set(patchRules('clockwork-isle').terrains.map((t) => t.id));
    for (const map of maps) {
      for (const t of map.tiles) {
        expect(allowed.has(t.terrain), t.terrain).toBe(true);
        expect(t.isle).toBeUndefined();
      }
    }
  });

  it('gives every land tile wind 1–3 and no water tile any', () => {
    for (const map of maps) {
      for (const t of map.tiles) {
        if (water(t)) expect(t.wind, `${t.q},${t.r} ${t.terrain}`).toBeUndefined();
        else expect([1, 2, 3], `${t.q},${t.r} ${t.terrain}`).toContain(t.wind);
      }
      // Posts, the Gap and the homes are land too.
      expect(map.tiles.filter(isTradingPost).every((t) => t.wind !== undefined)).toBe(true);
    }
  });

  it('splits the land about 15 / 50 / 35 % calm, breezy and windy (within 1 %)', () => {
    const want = [WIND_SPLIT.calm, WIND_SPLIT.breezy, 100 - WIND_SPLIT.calm - WIND_SPLIT.breezy];
    expect(want).toEqual([15, 50, 35]);
    for (const map of maps) {
      const land = map.tiles.filter((t) => !water(t));
      const counts = [1, 2, 3].map((w) => land.filter((t) => t.wind === w).length);
      counts.forEach((n, i) => {
        expect(Math.abs((n * 100) / land.length - want[i]!)).toBeLessThanOrEqual(1);
      });
    }
  });

  it('blows in stretches, windier on the coast and the hills than inland', () => {
    let same = 0;
    let pairs = 0;
    const mean = (tiles: readonly MapTile[]) =>
      tiles.reduce((s, t) => s + (t.wind ?? 0), 0) / tiles.length;
    for (const map of maps) {
      const byKey = byKeyOf(map);
      const land = map.tiles.filter((t) => !water(t));
      for (const t of land) {
        for (const n of hexNeighbors(t)) {
          const other = byKey.get(hexKey(n));
          if (other === undefined || water(other)) continue;
          pairs++;
          if (other.wind === t.wind) same++;
        }
      }
      const coast = land.filter((t) => t.terrain === rules.island.coastTerrain);
      const hills = land.filter((t) => t.terrain === 'hills');
      const plain = land.filter((t) => ['meadow', 'forest'].includes(t.terrain));
      expect(mean(coast)).toBeGreaterThan(mean(plain));
      if (hills.length >= 20) expect(mean(hills)).toBeGreaterThan(mean(plain));
    }
    // Unsmoothed, neighbours would match about 15² + 50² + 35² ≈ 39 % of the time.
    expect(same / pairs).toBeGreaterThan(0.55);
  });

  it('puts Scrap Heaps 2–3 walking steps from every Heart Seed, on open land', () => {
    const { perHome, minFromSeed } = rules.scrapHeaps;
    for (const map of maps) {
      const byKey = byKeyOf(map);
      const village = new Set(map.communities.flatMap((c) => c.tiles.map(hexKey)));
      const heaps = heapsOf(map);
      expect(heaps).toHaveLength(perHome * map.homes.length);
      for (const heap of heaps) {
        expect(heap.homeSlot).toBeNull();
        expect(water(heap)).toBe(false);
        expect(isTradingPost(heap)).toBe(false);
        expect(heap.terrain).not.toBe(GAME_DATA.mapGen.gapTerrain);
        expect(village.has(hexKey(heap))).toBe(false);
        // Never two side by side.
        for (const n of hexNeighbors(heap)) {
          expect(byKey.get(hexKey(n))?.nodeResource).not.toBe(SCRAP_HEAP_RESOURCE);
        }
      }
      for (const home of map.homes) {
        const steps = hexBfs([home], (h) => {
          const t = byKey.get(hexKey(h));
          return t !== undefined && !water(t);
        });
        const near = heaps.filter((t) => {
          const d = steps.get(hexKey(t));
          return d !== undefined && d >= minFromSeed && d <= SCRAP_HEAP_REACH;
        });
        expect(near.length).toBeGreaterThanOrEqual(1);
        expect(SCRAP_HEAP_REACH).toBeLessThanOrEqual(3);
      }
    }
  });
});
