import { describe, expect, it } from 'vitest';
import { FUEL_CONFIG, type FuelProfile } from './fuel-config.js';
import { renderFuel, runFuel } from './fuel-report.js';
import { buildBudget, planCost, planFires } from './fuel-cover.js';
import { fuelDay, gatherersPerDay, keeperPerDay, type EmberwoodLand } from './fuel.js';
import type { MapTile } from '../../src/mapgen/index.js';
import { hexKey, hexSpiral, type HexKey } from '../../src/hex/index.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const casual: FuelProfile = {
  id: 'casual',
  sessions: [8, 18],
  keeperNodes: 1,
  gatherers: 1,
  gathererSpeedPercent: 100,
  buildNodes: { timber: 1 },
  buildGatherers: {},
  buildShare: 50,
};
// The home Emberwood node: 2 a gather, 30 minutes (60 for a gatherer).
const home: EmberwoodLand = { nodes: 1, spots: [{ quantity: 2, seconds: 30 * 60 }], outer: 0 };

describe('the fuel model', () => {
  it('gives the Keeper one gather per tapped node per session', () => {
    expect(keeperPerDay(casual, home)).toBe(2 * 2);
    expect(keeperPerDay({ ...casual, keeperNodes: 3 }, { ...home, nodes: 2 })).toBe(2 * 2 * 2);
    expect(keeperPerDay(casual, { ...home, nodes: 0 })).toBe(0);
  });

  it('caps a gatherer at its stored cycles between sessions', () => {
    // 10 h and 14 h gaps, an hour a cycle, 4 cycles at most each time.
    expect(gatherersPerDay(casual, home)).toBe(2 * 4 * 2);
    // Two-hour gaps all day: two cycles each.
    const often = { ...casual, sessions: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] };
    expect(gatherersPerDay(often, home)).toBe(12 * 2 * 2);
    expect(gatherersPerDay({ ...casual, gatherers: 0 }, home)).toBe(0);
  });

  it('keeps lit the smaller of what the land allows and what the fuel feeds', () => {
    const day = fuelDay(14, casual, { ...home, outer: 2 });
    expect(day.landFires).toBe(2);
    expect(day.fuelFires).toBe(20);
    expect(day.lit).toBe(2);
    expect(fuelDay(14, { ...casual, gatherers: 0 }, { ...home, outer: 10 }).lit).toBe(4);
  });
});

describe('runFuel', () => {
  const short = { ...FUEL_CONFIG, days: [3], seats: [2] };
  const small = { ...PROGRESSION_CONFIG, estimateGames: 4 };

  it('is the same for the same config and data, and reports every kid', () => {
    const rows = runFuel(short, small);
    expect(runFuel(short, small)).toEqual(rows);
    expect(rows.map((r) => r.kid)).toEqual(FUEL_CONFIG.profiles.map((p) => p.id));
    for (const d of rows.flatMap((r) => r.days)) {
      expect(d.lit).toBe(Math.min(d.landFires, d.fuelFires));
    }
    expect(renderFuel(rows, short, { seconds: 0 })).toContain('| 2 | casual | 3 |');
  });
});

describe('lighting all the land (#277)', () => {
  const tile = (q: number, r: number, extra: Partial<MapTile> = {}): MapTile =>
    ({ q, r, terrain: 'meadow', homeSlot: null, nodeResource: null, ...extra }) as MapTile;
  const strip = (n: number) => Array.from({ length: n }, (_, i) => tile(i + 2, 0));
  const tilesOf = (list: readonly MapTile[]) => new Map(list.map((t) => [hexKey(t), t]));

  it('lights every outer tile, never from a node tile, and uses wider fires when fuel is short', () => {
    const land = [
      ...hexSpiral({ q: 0, r: 0 }, 1).map((h) => tile(h.q, h.r, { homeSlot: 0 })),
      ...strip(9),
    ];
    const tiles = tilesOf(land);
    const keys: HexKey[] = land.map(hexKey);
    const plenty = planFires(keys, tiles, 99);
    expect(plenty.fires.every((f) => f.level === 0)).toBe(true);
    expect(plenty.fires).toHaveLength(3);
    const short = planFires(keys, tiles, 2);
    expect(short.fires.length).toBeLessThanOrEqual(2);
    expect(short.fires.some((f) => f.level === 2)).toBe(true);
    expect(planCost(plenty)).toEqual({ timber: 15, stone: 15 });
    // A node in the middle of every tile: nowhere to stand a fire.
    const nodes = tilesOf(
      land.map((t) => (t.homeSlot === null ? { ...t, nodeResource: 'timber' } : t)),
    );
    expect(planFires(keys, nodes, 99)).toMatchObject({ fires: [], outOfReach: 9 });
  });

  it("banks a share of the Keeper's build gathers for fires", () => {
    const owned = [tile(0, 0, { nodeResource: 'timber' })];
    // Two sessions, a gather of 5 each: 10 a day, half for fires.
    expect(buildBudget(casual, 7, owned)).toEqual({ timber: 35 });
    expect(buildBudget(casual, 7, [])).toEqual({ timber: 0 });
  });

  // The gate (the coordinator's guardrail c): a casual kid lights ALL their
  // land, fuel and build cost included, on days 7, 14 and 30. If this fails,
  // tune yields and costs in data, never the radii.
  it('lets a casual kid light all their land on days 7, 14 and 30', () => {
    const rows = runFuel(FUEL_CONFIG, PROGRESSION_CONFIG).filter((r) =>
      FUEL_CONFIG.lightsAllLand.includes(r.kid),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.days.map((d) => d.day)).toEqual([7, 14, 30]);
      for (const d of row.days) {
        expect({
          seats: row.seats,
          day: d.day,
          fuel: d.cover.fuelOk,
          build: d.cover.costOk,
        }).toEqual({
          seats: row.seats,
          day: d.day,
          fuel: true,
          build: true,
        });
      }
    }
  });
});
