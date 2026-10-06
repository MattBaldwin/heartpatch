import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { GAME_DATA } from '../data/index.js';
import { hex, hexDistance, hexKey, hexSpiral } from '../hex/index.js';
import { activeSeasons } from '../data/season-windows.js';
import { HomeBaseRulesSchema, isBuildable } from '../schemas/data/home-base.js';
import { checkGameData } from '../schemas/data/game-data.js';
import type { HearthfireBuilding } from '../schemas/data/buildings.js';
import {
  addDays,
  addFuel,
  buildCost,
  daysBetween,
  freeSpots,
  fuelCost,
  fuelSpace,
  hearthfireState,
  isReservedSpot,
  localDateFromDays,
  localDateToDays,
  protectsNight,
  removeRefund,
  safeTiles,
  spentOn,
  upgradeCost,
  spotOffset,
  tonightOf,
  type MapLocalTime,
} from './index.js';

const building = (id: string) => {
  const found = BUILDINGS.find((b) => b.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};
const fire = building('hearthfire') as HearthfireBuilding;
const lantern = building('jack-o-lantern-hearthfire') as HearthfireBuilding;
const RULES = HOME_BASE_RULES;
const at = (date: string, hh: number, mm = 0): MapLocalTime => ({ date, minute: hh * 60 + mm });

describe('local dates', () => {
  it('round-trips day numbers across months, leap days and years', () => {
    expect(localDateToDays('1970-01-01')).toBe(0);
    for (const date of ['2024-02-29', '2026-10-31', '2026-12-31', '2027-01-01', '1999-03-01']) {
      expect(localDateFromDays(localDateToDays(date))).toBe(date);
    }
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-30', '2026-11-04')).toBe(5);
    expect(daysBetween('2026-11-04', '2026-10-30')).toBe(-5);
  });
});

describe('Hearthfire fuel (tech spec §7)', () => {
  it('belongs to tonight before nightfall and to tomorrow after it', () => {
    expect(tonightOf(at('2026-10-31', 20, 59), RULES)).toBe('2026-10-31');
    expect(tonightOf(at('2026-10-31', 21, 0), RULES)).toBe('2026-11-01');
    expect(tonightOf(at('2026-12-31', 23, 30), RULES)).toBe('2027-01-01');
    expect(tonightOf(at('2026-10-31', 0, 5), RULES)).toBe('2026-10-31');
  });

  it('is out before it is ever fuelled', () => {
    expect(hearthfireState(null, at('2026-10-02', 12), RULES)).toEqual({
      tonight: '2026-10-02',
      nightsLeft: 0,
      lit: false,
    });
    expect(fuelSpace(fire, null, at('2026-10-02', 12), RULES)).toBe(5);
  });

  it('counts down one night per nightfall without anything being decremented', () => {
    // Fuelled at noon with 3 nights: Oct 2, 3 and 4.
    const through = addFuel(fire, null, at('2026-10-02', 12), 3, RULES);
    expect(through).toBe('2026-10-04');
    const left = (local: MapLocalTime) => hearthfireState(through, local, RULES).nightsLeft;
    expect(left(at('2026-10-02', 20))).toBe(3);
    expect(left(at('2026-10-02', 21))).toBe(2); // tonight's nightfall has happened
    expect(left(at('2026-10-03', 9))).toBe(2);
    expect(left(at('2026-10-04', 20, 59))).toBe(1);
    expect(left(at('2026-10-04', 21))).toBe(0);
    expect(hearthfireState(through, at('2026-10-05', 9), RULES).lit).toBe(false);
    // What nightfall (#21) asks: is the night being resolved covered?
    expect(protectsNight(through, '2026-10-04')).toBe(true);
    expect(protectsNight(through, '2026-10-05')).toBe(false);
    expect(protectsNight(null, '2026-10-05')).toBe(false);
  });

  it('caps at the most nights it can hold, counted from tonight', () => {
    const local = at('2026-10-02', 12);
    expect(addFuel(fire, null, local, 9, RULES)).toBe('2026-10-06'); // 5 nights: Oct 2–6
    const full = addFuel(fire, null, local, 5, RULES);
    expect(fuelSpace(fire, full, local, RULES)).toBe(0);
    expect(addFuel(fire, full, local, 1, RULES)).toBe(full);
    // A night later one more fits.
    expect(fuelSpace(fire, full, at('2026-10-03', 12), RULES)).toBe(1);
    expect(addFuel(fire, full, at('2026-10-03', 12), 1, RULES)).toBe('2026-10-07');
  });

  it('tops up from tonight when the fire went out long ago', () => {
    expect(addFuel(fire, '2026-09-01', at('2026-10-02', 22), 2, RULES)).toBe('2026-10-04');
  });

  it('adds onto fuel already there', () => {
    expect(addFuel(fire, '2026-10-03', at('2026-10-02', 12), 2, RULES)).toBe('2026-10-05');
  });

  it('crosses month and year ends', () => {
    expect(addFuel(fire, null, at('2026-12-30', 21, 30), 5, RULES)).toBe('2027-01-04');
    expect(hearthfireState('2027-01-04', at('2027-01-01', 1), RULES).nightsLeft).toBe(4);
  });

  it('refuses a non-whole number of nights', () => {
    expect(() => addFuel(fire, null, at('2026-10-02', 12), 0, RULES)).toThrow(RangeError);
    expect(() => addFuel(fire, null, at('2026-10-02', 12), 1.5, RULES)).toThrow(RangeError);
  });

  it('costs one Emberwood per night', () => {
    expect(fuelCost(fire, 3)).toEqual({ emberwood: 3 });
  });
});

describe('safe tiles (design doc §14)', () => {
  const home = hexSpiral(hex(5, -2), 1);

  it('covers the whole home base and every tile within the radius of the fire', () => {
    // A level-1 fire on a ring tile reaches one tile past the home on that side.
    const ringTile = hex(6, -2);
    const safe = safeTiles([{ at: ringTile, radius: 1, homeTiles: home }]);
    for (const h of home) expect(safe.has(hexKey(h))).toBe(true);
    for (const h of hexSpiral(ringTile, 1)) expect(safe.has(hexKey(h))).toBe(true);
    expect(safe.has(hexKey(hex(7, -2)))).toBe(true);
    expect(safe.has(hexKey(hex(3, -2)))).toBe(false); // the far side, 2 past the home
    expect(safe.size).toBe(7 + 3);
  });

  it('reaches further from a Jack-o-Lantern fire', () => {
    const radius = lantern.levels[0]!.safeRadius;
    const safe = safeTiles([{ at: hex(5, -2), radius, homeTiles: home }]);
    expect(safe.size).toBe(1 + 3 * radius * (radius + 1));
    for (const key of safe) {
      const [q, r] = key.split(',').map(Number);
      expect(hexDistance(hex(q!, r!), hex(5, -2))).toBeLessThanOrEqual(radius);
    }
    expect(radius).toBeGreaterThan(fire.levels[0]!.safeRadius);
  });

  it('is empty with no lit fires, and joins several', () => {
    expect(safeTiles([]).size).toBe(0);
    const other = hexSpiral(hex(-5, 2), 1);
    const safe = safeTiles([
      { at: hex(5, -2), radius: 0, homeTiles: home },
      { at: hex(-5, 2), radius: 0, homeTiles: other },
    ]);
    expect(safe.size).toBe(14);
  });
});

describe('building spots', () => {
  it('has a middle spot and six around it', () => {
    expect(spotOffset(0)).toEqual(hex(0, 0));
    const ring = [1, 2, 3, 4, 5, 6].map(spotOffset);
    expect(new Set(ring.map(hexKey)).size).toBe(6);
    for (const h of ring) expect(hexDistance(h, hex(0, 0))).toBe(1);
    expect(() => spotOffset(7)).toThrow(RangeError);
  });

  it('keeps the middle for the Heart Seed and resource nodes', () => {
    const plain = { heartSeed: false, nodeResource: null };
    expect(isReservedSpot(plain, 0)).toBe(false);
    expect(isReservedSpot({ heartSeed: true, nodeResource: null }, 0)).toBe(true);
    expect(isReservedSpot({ heartSeed: false, nodeResource: 'timber' }, 0)).toBe(true);
    expect(isReservedSpot({ heartSeed: true, nodeResource: null }, 3)).toBe(false);
    expect(freeSpots(RULES, plain, new Set([0, 2]))).toEqual([1, 3, 4, 5, 6]);
    expect(freeSpots(RULES, { heartSeed: true, nodeResource: null }, new Set())).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('building costs and refunds', () => {
  it('builds for the level-1 cost', () => {
    expect(buildCost(fire)).toEqual({ timber: 5, stone: 5 });
    expect(spentOn(fire, 2)).toEqual({ timber: 15, stone: 15 });
  });

  it('gives back half, rounded down, when taken down', () => {
    expect(removeRefund(building('cozy-meadow'), 1, RULES)).toEqual({ timber: 2, stone: 1 });
    expect(removeRefund(fire, 1, { removeRefundPercent: 0 })).toEqual({});
  });

  it('costs the next level to upgrade, and nothing past the top', () => {
    expect(upgradeCost(fire, 1)).toEqual({ timber: 10, stone: 10 });
    expect(upgradeCost(fire, 2)).toEqual({ timber: 20, stone: 15, glimmer: 2 });
    expect(upgradeCost(fire, 3)).toBeNull();
    expect(upgradeCost(lantern, 1)).toBeNull();
    expect(upgradeCost(building('cozy-meadow'), 1)).toEqual({ timber: 8, stone: 4 });
    // What an upgraded building cost in all is what a take-down refunds from.
    expect(spentOn(fire, 3)).toEqual({ timber: 35, stone: 30, glimmer: 2 });
  });

  it('always gives the carved pumpkin back whole', () => {
    expect(removeRefund(lantern, 1, RULES)).toEqual({ 'jack-o-lantern-hearthfire': 1 });
  });
});

describe('home-base data', () => {
  it('checks out', () => {
    expect(HomeBaseRulesSchema.parse(HOME_BASE_RULES)).toEqual(HOME_BASE_RULES);
    expect(checkGameData(GAME_DATA)).toEqual([]);
  });

  it('builds the Jack-o-Lantern Hearthfire from the crafted item, only around Halloween', () => {
    expect(lantern.season).toBe('halloween');
    expect(buildCost(lantern)).toEqual({ 'jack-o-lantern-hearthfire': 1 });
    const recipe = GAME_DATA.recipes.find((r) => r.id === 'jack-o-lantern-hearthfire');
    expect(recipe?.output.resource).toBe('jack-o-lantern-hearthfire');
    expect(activeSeasons(GAME_DATA.seasons, '2026-10-31').map((s) => s.id)).toContain(
      lantern.season,
    );
  });

  it('lets players build fires, habitats and Training Grounds', () => {
    expect(BUILDINGS.filter((b) => isBuildable(RULES, b)).map((b) => b.id)).toEqual([
      'hearthfire',
      'jack-o-lantern-hearthfire',
      'ember-den',
      'cozy-meadow',
      'training-grounds',
    ]);
  });

  it('allows one Training Grounds per home (the Train job picks "my" Training Grounds)', () => {
    expect(building('training-grounds').maxPerHome).toBe(1);
  });

  it('names the carved pumpkin apart from the fire built from it', () => {
    const item = GAME_DATA.resources.find((r) => r.id === 'jack-o-lantern-hearthfire');
    expect(item?.name).toBe("Jack-o'-Lantern");
    expect(lantern.name).toBe("Jack-o'-Lantern Hearthfire");
  });
});
