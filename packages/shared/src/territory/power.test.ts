import { describe, expect, it } from 'vitest';
import { POWER_RULES } from '../data/power.js';
import { hexKey, type Hex } from '../hex/index.js';
import type { PowerRules } from '../schemas/data/power.js';
import {
  isGenerator,
  needsPower,
  POWER_BUILDING_IDS,
  powerReach,
  poweredSet,
  type PowerTile,
} from './power.js';

const ME = '00000000-0000-4000-8000-000000000001';
const YOU = '00000000-0000-4000-8000-000000000002';

/** A row of land tiles along r = 0, q = 0…n-1, all mine unless listed. */
function row(n: number, owners: Record<number, string | null> = {}): PowerTile[] {
  return Array.from({ length: n }, (_, q) => ({
    q,
    r: 0,
    terrain: 'meadow',
    ownerUserId: q in owners ? (owners[q] ?? null) : ME,
  }));
}

const at = (q: number, ownerUserId = ME) => ({ q, r: 0, ownerUserId });
const keys = (hexes: readonly Hex[]) => hexes.map(hexKey).sort();
const RULES: PowerRules = { ...POWER_RULES, model: 'wires', wire: { cost: {}, maxRun: 3 } };

describe('power (Clockwork Isle, #874)', () => {
  it('knows the Windmill is a generator and the Sorter and Beacon need power', () => {
    expect(isGenerator('windmill')).toBe(true);
    expect(needsPower('sorter')).toBe(true);
    expect(needsPower('clockwork-beacon')).toBe(true);
    expect(needsPower('windmill')).toBe(false);
    expect(POWER_BUILDING_IDS).toEqual(expect.arrayContaining(['windmill', 'sorter']));
  });

  it('carries power along a wire chain up to maxRun, and no further', () => {
    const tiles = row(8);
    const wires = [1, 2, 3, 4].map((q) => at(q));
    const reach = powerReach(tiles, wires, [at(0)], ME, RULES);
    expect([...reach]).toEqual([
      [hexKey({ q: 1, r: 0 }), 1],
      [hexKey({ q: 2, r: 0 }), 2],
      [hexKey({ q: 3, r: 0 }), 3],
    ]);
    // The tile after the last carrying wire is powered (next to it); past the fourth wire, not.
    const powered = poweredSet(tiles, wires, [at(0)], ME, RULES);
    expect(powered.has(hexKey({ q: 4, r: 0 }))).toBe(true);
    expect(powered.has(hexKey({ q: 5, r: 0 }))).toBe(false);
  });

  it('counts standing next to a generator, with no wire at all', () => {
    const powered = poweredSet(row(4), [], [at(1)], ME, RULES);
    expect([...powered].sort()).toEqual(keys([at(0), at(1), at(2)]));
  });

  it("never lets another owner's generator or wires power me", () => {
    const tiles = row(6, { 0: YOU, 1: YOU });
    const powered = poweredSet(tiles, [at(1, YOU), at(2, YOU)], [at(0, YOU)], ME, RULES);
    expect(powered.size).toBe(0);
    // A wire of mine joined to their generator carries nothing either.
    expect(powerReach(tiles, [at(2)], [at(1, YOU)], ME, RULES).size).toBe(0);
  });

  it('drops a wire or a generator on land I no longer hold', () => {
    const tiles = row(5, { 2: YOU });
    // My wire left on a tile you won breaks the chain.
    const reach = powerReach(tiles, [at(1), at(2), at(3)], [at(0)], ME, RULES);
    expect([...reach.keys()]).toEqual([hexKey(at(1))]);
    expect(poweredSet(tiles, [], [at(2)], ME, RULES).size).toBe(0);
  });

  it('a chain that never reaches a generator carries nothing', () => {
    expect(powerReach(row(8), [at(4), at(5)], [at(0)], ME, RULES).size).toBe(0);
  });

  it("model 'radius': within radius tiles of a generator, no wires", () => {
    const rules: PowerRules = { ...RULES, model: 'radius', radius: 2 };
    const powered = poweredSet(row(6), [at(4)], [at(0)], ME, rules);
    expect([...powered].sort()).toEqual(keys([at(0), at(1), at(2)]));
  });

  it("model 'none': all my land while I have a generator anywhere", () => {
    const rules: PowerRules = { ...RULES, model: 'none' };
    expect(poweredSet(row(6), [], [at(5)], ME, rules).size).toBe(6);
    expect(poweredSet(row(6), [], [], ME, rules).size).toBe(0);
  });

  it('water is never powered', () => {
    const tiles = row(3).map((t) => (t.q === 2 ? { ...t, terrain: 'river' } : t));
    expect(poweredSet(tiles, [], [at(1)], ME, RULES).has(hexKey(at(2)))).toBe(false);
  });
});
