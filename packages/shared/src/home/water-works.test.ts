import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { JOB_RULES } from '../data/jobs.js';
import { RESOURCE_BUILDING_RULES } from '../data/resource-buildings.js';
import { hex, hexKey } from '../hex/index.js';
import { isBuildable } from '../schemas/data/home-base.js';
import { economyEffects, wildIsleEffects } from './building-effects.js';
import {
  canalFits,
  canalReach,
  hasWaterNextDoor,
  isBuildableOn,
  waterKindOf,
  waterRefusalOf,
  type WaterWorksTile,
} from './water-works.js';

// A row of tiles along r = 0: a river at q = 0, meadow from q = 1 to 8.
const ROW: WaterWorksTile[] = [
  { q: 0, r: 0, terrain: 'river' },
  ...Array.from({ length: 8 }, (_, i) => ({ q: i + 1, r: 0, terrain: 'meadow' })),
  { q: 0, r: 5, terrain: 'ocean' },
  { q: 1, r: 5, terrain: 'coast' },
  { q: 0, r: 8, terrain: 'wild-lake' },
  { q: 1, r: 8, terrain: 'meadow' },
];
const at = (q: number) => hex(q, 0);
const byId = (id: string) => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`no building ${id}`);
  return b;
};

describe('water next door (#621 W1-8)', () => {
  it('knows each water terrain’s kind, and land has none', () => {
    expect(waterKindOf('ocean')).toBe('deep');
    expect(waterKindOf('river')).toBe('river');
    expect(waterKindOf('wild-lake')).toBe('lake');
    expect(waterKindOf('lake')).toBeNull(); // Cozy's lake is land
    expect(waterKindOf('coast')).toBeNull();
  });

  it('finds the water a building needs on a neighbouring tile', () => {
    expect(hasWaterNextDoor(at(1), ROW, [], ['river'], 4)).toBe(true);
    expect(hasWaterNextDoor(at(1), ROW, [], ['deep'], 4)).toBe(false);
    expect(hasWaterNextDoor(hex(1, 5), ROW, [], ['deep'], 4)).toBe(true);
    expect(hasWaterNextDoor(hex(1, 8), ROW, [], ['river', 'lake'], 4)).toBe(true);
    expect(hasWaterNextDoor(at(3), ROW, [], ['deep', 'river', 'lake'], 4)).toBe(false);
    expect(hasWaterNextDoor(at(3), ROW, [], undefined, 4)).toBe(true);
  });

  it('counts a chain of canals from the water, up to maxRun', () => {
    const canals = [at(1), at(2), at(3), at(4), at(5)];
    const reach = canalReach(ROW, canals, 4);
    expect([...reach.entries()]).toEqual([
      [hexKey(at(1)), 1],
      [hexKey(at(2)), 2],
      [hexKey(at(3)), 3],
      [hexKey(at(4)), 4],
    ]);
    // A field beside the chain's 4th canal has water; one past the 5th (beyond maxRun) doesn't.
    expect(hasWaterNextDoor(at(5), ROW, canals.slice(0, 4), ['canal'], 4)).toBe(true);
    expect(hasWaterNextDoor(at(6), ROW, canals, ['canal'], 4)).toBe(false);
    // Only a canal carries: without `canal` in its needs, the chain is no help.
    expect(hasWaterNextDoor(at(5), ROW, canals, ['river'], 4)).toBe(false);
  });

  it('never carries water along a chain that doesn’t touch any', () => {
    const dry = [at(3), at(4), at(5)];
    expect(canalReach(ROW, dry, 4).size).toBe(0);
    expect(hasWaterNextDoor(at(6), ROW, dry, ['canal'], 4)).toBe(false);
  });

  it('lets a canal go next to water or a carrying canal with room in its run', () => {
    expect(canalFits(at(1), ROW, [], 4)).toBe(true);
    expect(canalFits(at(2), ROW, [], 4)).toBe(false);
    expect(canalFits(at(2), ROW, [at(1)], 4)).toBe(true);
    expect(canalFits(at(5), ROW, [at(1), at(2), at(3), at(4)], 4)).toBe(false);
    expect(canalFits(at(4), ROW, [at(2), at(3)], 4)).toBe(false); // that chain is dry
  });

  it('picks the held-back line by what the building needs (plan §8)', () => {
    expect(waterRefusalOf(byId('salt-pans'))).toBe('coast');
    expect(waterRefusalOf(byId('seawall'))).toBe('coast');
    expect(waterRefusalOf(byId('watermill'))).toBe('river');
    expect(waterRefusalOf(byId('levee'))).toBe('river');
    expect(waterRefusalOf(byId('fishing-pier'))).toBe('water');
    expect(waterRefusalOf(byId('river-well'))).toBe('river-or-lake');
    expect(waterRefusalOf(byId('irrigated-field'))).toBe('water');
    expect(waterRefusalOf(byId('canal'))).toBe('canal');
  });
});

describe('isBuildableOn (#621 W1-8)', () => {
  it('is isBuildable on a Cozy Patch, building for building', () => {
    for (const b of BUILDINGS) {
      expect(isBuildableOn(HOME_BASE_RULES, b, 'cozy'), b.id).toBe(isBuildable(HOME_BASE_RULES, b));
    }
  });

  it('adds every Wild Isle building on a Wild Isle but the Waystation', () => {
    const wild = BUILDINGS.filter(
      (b) => isBuildableOn(HOME_BASE_RULES, b, 'wild-isle') && !isBuildable(HOME_BASE_RULES, b),
    ).map((b) => b.id);
    expect(wild).toEqual([
      'bridge',
      'ferry-dock',
      'river-well',
      'fishing-pier',
      'salt-pans',
      'watermill',
      'irrigated-field',
      'rain-barrel',
      'canal',
      'levee',
      'seawall',
      'weather-vane',
    ]);
  });
});

describe('Wild Isle building effects (#621 W1-8)', () => {
  const rules = {
    jobs: JOB_RULES,
    explore: EXPLORE_RULES,
    resourceBuildings: RESOURCE_BUILDING_RULES,
  };

  it("gives a works its output and upkeep, like a resource building's card", () => {
    expect(economyEffects(byId('fishing-pier'), 1, rules)).toEqual([
      { kind: 'produces', resource: 'fish', perHour: 6, storageHours: 24, upkeep: 10 },
    ]);
    // The River Well makes what the Cozy well does.
    expect(economyEffects(byId('river-well'), 2, rules)).toEqual(
      economyEffects(byId('water-well'), 2, rules),
    );
  });

  it('says what each new building needs and does', () => {
    expect(wildIsleEffects(byId('watermill'))).toEqual([
      { kind: 'needs-water', water: ['river'] },
      { kind: 'eats', items: { greens: 2 } },
    ]);
    expect(wildIsleEffects(byId('fishing-pier'))).toEqual([
      { kind: 'needs-water', water: ['deep', 'river', 'lake'] },
      { kind: 'weather', percent: { fog: 150 } },
    ]);
    expect(wildIsleEffects(byId('rain-barrel'))).toEqual([{ kind: 'only-while', weather: 'rain' }]);
    expect(wildIsleEffects(byId('canal'))).toEqual([{ kind: 'carries-water', maxRun: 4 }]);
    expect(wildIsleEffects(byId('seawall'))).toEqual([
      { kind: 'needs-water', water: ['deep'] },
      { kind: 'shelters', radius: 1, from: ['storm', 'flood'] },
    ]);
    expect(wildIsleEffects(byId('weather-vane'))).toEqual([{ kind: 'forecast' }]);
    expect(wildIsleEffects(byId('greenhouse'))).toEqual([{ kind: 'weatherproof' }]);
    expect(wildIsleEffects(byId('hearthfire'))).toEqual([]);
    // Every Wild Isle building but the crossings says something.
    for (const b of BUILDINGS) {
      if (b.patchTypes === undefined || b.kind === 'travel') continue;
      const said = wildIsleEffects(b).length + economyEffects(b, 1, rules).length;
      expect(said, b.id).toBeGreaterThan(0);
    }
  });
});
