import { describe, expect, it } from 'vitest';
import { FUEL_CONFIG, type FuelProfile } from './fuel-config.js';
import { renderFuel, runFuel } from './fuel-report.js';
import { fuelDay, gatherersPerDay, keeperPerDay, type EmberwoodLand } from './fuel.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const casual: FuelProfile = {
  id: 'casual',
  sessions: [8, 18],
  keeperNodes: 1,
  gatherers: 1,
  gathererSpeedPercent: 100,
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
    expect(day.landFires).toBe(3);
    expect(day.fuelFires).toBe(20);
    expect(day.lit).toBe(3);
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
