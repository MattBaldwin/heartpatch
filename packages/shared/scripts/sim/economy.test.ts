import { describe, expect, it } from 'vitest';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { GAME_DATA } from '../../src/data/index.js';
import { hex, hexKey, hexSpiral, type HexKey } from '../../src/hex/index.js';
import { generateMap } from '../../src/mapgen/index.js';
import { ECONOMY_CONFIG, type EconomyProfile } from './economy-config.js';
import { gainPercent, renderEconomy, runEconomy } from './economy-report.js';
import {
  exploreDay,
  gatherersPerDay,
  homesteadsOf,
  keeperPerDay,
  total,
  type ExploreProgress,
  type GatherSpot,
} from './economy.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const casual: EconomyProfile = {
  id: 'casual',
  kid: 'casual',
  sessions: [8, 18],
  keeperNodes: 1,
  gatherers: 1,
  searchesPerDay: 10,
};
const hourly: EconomyProfile = {
  ...casual,
  id: 'hourly',
  sessions: Array.from({ length: 24 }, (_, h) => h),
};
// Forest land: 2 Timber a gather, 15 minutes (30 for a gatherer, 24 on a homestead).
const forest: GatherSpot = {
  resource: 'timber',
  quantity: 2,
  seconds: 15 * 60,
  from: 'land',
  homestead: false,
};
const homestead: GatherSpot = { ...forest, homestead: true };

describe('the economy model', () => {
  it('gives the homestead bonus only on homesteads, and only when it is switched on', () => {
    const plain = gatherersPerDay(hourly, [forest], true);
    expect(gatherersPerDay(hourly, [forest], false)).toEqual(plain);
    const faster = gatherersPerDay(hourly, [homestead], true);
    expect(total(faster)).toBeGreaterThan(total(plain));
    expect(total(gatherersPerDay(hourly, [homestead], false))).toBe(total(plain));
  });

  it('shows the stored-cycle cap swallowing the bonus for a kid who rarely looks', () => {
    // 10 h and 14 h gaps: four cycles either way.
    expect(gatherersPerDay(casual, [homestead], true)).toEqual(
      gatherersPerDay(casual, [homestead], false),
    );
  });

  it('lands one Keeper gather per tapped node per finished session gap', () => {
    const node: GatherSpot = { ...forest, from: 'node' };
    expect(keeperPerDay(casual, [node, forest], false)).toEqual({ timber: 2 * 2 });
    expect(keeperPerDay({ ...casual, keeperNodes: 0 }, [node], false)).toEqual({});
  });

  it('explores the nearest land first and joins it as homesteads', () => {
    const map = generateMap(GAME_DATA, { seed: PROGRESSION_CONFIG.mapSeed, playerCount: 2 });
    const tiles = new Map(map.tiles.map((t) => [hexKey(t), t]));
    const home = map.tiles.filter((t) => t.homeSlot === 0);
    const seed = home.find((t) =>
      hexSpiral(t, 1).every((h) => tiles.get(hexKey(h))?.homeSlot === 0),
    );
    if (!seed) throw new Error('no Heart Seed');
    // Home plus every explorable tile in the ring just outside it.
    const ring2 = hexSpiral(seed, 2)
      .slice(7)
      .filter((h) => tiles.get(hexKey(h))?.homeSlot === null);
    const land: HexKey[] = [...home.map(hexKey), ...ring2.map(hexKey)];
    const progress: ExploreProgress = new Map();
    exploreDay(progress, land, tiles, PROGRESSION_CONFIG.mapSeed, { searchesPerDay: 1000 });
    const explorable = ring2.filter((h) =>
      EXPLORE_RULES.terrains.some((t) => t.terrain === tiles.get(hexKey(h))?.terrain),
    );
    expect(homesteadsOf(land, tiles, progress).size).toBe(explorable.length);
    // A tile far from home, explored, isn't a homestead.
    const far = hexKey(hex(seed.q + 5, seed.r));
    expect(
      homesteadsOf([...home.map(hexKey), far], tiles, new Map([[far, { spots: 1, searched: 1 }]]))
        .size,
    ).toBe(0);
  });
});

describe('runEconomy', () => {
  const short = { ...ECONOMY_CONFIG, days: [3], seats: [2] };
  const small = { ...PROGRESSION_CONFIG, estimateGames: 4 };

  it('is the same for the same config and data, and never gathers less with homesteads', () => {
    const rows = runEconomy(short, small);
    expect(runEconomy(short, small)).toEqual(rows);
    expect(rows.map((r) => r.kid)).toEqual(ECONOMY_CONFIG.profiles.map((p) => p.id));
    for (const d of rows.flatMap((r) => r.days)) {
      expect(total(d.with)).toBeGreaterThanOrEqual(total(d.without));
      expect(gainPercent(d)).toBeGreaterThanOrEqual(0);
      expect(d.homesteads).toBeLessThanOrEqual(d.explored);
    }
    expect(renderEconomy(rows, short, { seconds: 0 })).toContain('| 2 | casual | 3 |');
  });
});
