import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { GAME_DATA } from '../data/index.js';
import { hex, hexDistance, hexKey, hexSpiral } from '../hex/index.js';
import { activeSeasons } from '../data/season-windows.js';
import { HomeBaseRulesSchema, isBuildable } from '../schemas/data/home-base.js';
import { checkGameData } from '../schemas/data/game-data.js';
import { buildsAtHome, type HearthfireBuilding } from '../schemas/data/buildings.js';
import {
  addDays,
  addFuel,
  buildCost,
  daysBetween,
  fitsSlot,
  freeSpots,
  fuelCost,
  fuelSpace,
  hearthfireState,
  isReservedSpot,
  planFuelAll,
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
    expect(tonightOf(at('2026-10-31', 18, 59), RULES)).toBe('2026-10-31');
    expect(tonightOf(at('2026-10-31', 19, 0), RULES)).toBe('2026-11-01');
    expect(tonightOf(at('2026-12-31', 23, 30), RULES)).toBe('2027-01-01');
    expect(tonightOf(at('2026-10-31', 0, 5), RULES)).toBe('2026-10-31');
  });

  it('is out before it is ever fuelled', () => {
    expect(hearthfireState(null, at('2026-10-02', 12), RULES)).toEqual({
      tonight: '2026-10-02',
      nightsLeft: 0,
      lit: false,
    });
    expect(fuelSpace(fire, null, at('2026-10-02', 12), RULES)).toBe(8);
  });

  it('counts down one night per nightfall without anything being decremented', () => {
    // Fuelled at noon with 3 nights: Oct 2, 3 and 4.
    const through = addFuel(fire, null, at('2026-10-02', 12), 3, RULES);
    expect(through).toBe('2026-10-04');
    const left = (local: MapLocalTime) => hearthfireState(through, local, RULES).nightsLeft;
    expect(left(at('2026-10-02', 18))).toBe(3);
    expect(left(at('2026-10-02', 19))).toBe(2); // tonight's nightfall has happened
    expect(left(at('2026-10-03', 9))).toBe(2);
    expect(left(at('2026-10-04', 18, 59))).toBe(1);
    expect(left(at('2026-10-04', 19))).toBe(0);
    expect(hearthfireState(through, at('2026-10-05', 9), RULES).lit).toBe(false);
    // What nightfall (#21) asks: is the night being resolved covered?
    expect(protectsNight(through, '2026-10-04')).toBe(true);
    expect(protectsNight(through, '2026-10-05')).toBe(false);
    expect(protectsNight(null, '2026-10-05')).toBe(false);
  });

  it('caps at the most nights it can hold, counted from tonight', () => {
    const local = at('2026-10-02', 12);
    expect(addFuel(fire, null, local, 9, RULES)).toBe('2026-10-09'); // 8 nights: Oct 2–9
    const full = addFuel(fire, null, local, 8, RULES);
    expect(fuelSpace(fire, full, local, RULES)).toBe(0);
    expect(addFuel(fire, full, local, 1, RULES)).toBe(full);
    // A night later one more fits.
    expect(fuelSpace(fire, full, at('2026-10-03', 12), RULES)).toBe(1);
    expect(addFuel(fire, full, at('2026-10-03', 12), 1, RULES)).toBe('2026-10-10');
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

  it('keeps every home base safe, fire or not (the Heart Seed, owner decision 2026-10-07)', () => {
    const safe = safeTiles([], home);
    expect(safe.size).toBe(7);
    for (const h of home) expect(safe.has(hexKey(h))).toBe(true);
  });

  it("adds a lit fire's tile and every tile within its radius, out on captured land", () => {
    const land = hex(8, -2);
    const safe = safeTiles([{ at: land, radius: 1 }], home);
    for (const h of hexSpiral(land, 1)) expect(safe.has(hexKey(h))).toBe(true);
    expect(safe.has(hexKey(hex(10, -2)))).toBe(false);
    // Two tiles past the home's edge: home and the fire's reach don't overlap.
    expect(safe.size).toBe(7 + 7);
  });

  it('lights its ring from a Jack-o-Lantern fire (#277: radius 1, like a new Hearthfire)', () => {
    const radius = lantern.levels[0]!.safeRadius;
    const safe = safeTiles([{ at: hex(5, -2), radius }]);
    expect(safe.size).toBe(1 + 3 * radius * (radius + 1));
    for (const key of safe) {
      const [q, r] = key.split(',').map(Number);
      expect(hexDistance(hex(q!, r!), hex(5, -2))).toBeLessThanOrEqual(radius);
    }
    expect(radius).toBe(fire.levels[0]!.safeRadius);
  });

  it('is empty with no homes and no lit fires, and joins several', () => {
    expect(safeTiles([]).size).toBe(0);
    const safe = safeTiles([
      { at: hex(5, -2), radius: 0 },
      { at: hex(-5, 2), radius: 0 },
    ]);
    expect(safe.size).toBe(2);
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

  it('offers a light only the middle and a building only the ring (#204)', () => {
    const plain = { heartSeed: false, nodeResource: null };
    expect(freeSpots(RULES, plain, new Set(), 'centre')).toEqual([0]);
    expect(freeSpots(RULES, plain, new Set([0]), 'centre')).toEqual([]);
    expect(
      freeSpots(RULES, { heartSeed: false, nodeResource: 'timber' }, new Set(), 'centre'),
    ).toEqual([]);
    expect(freeSpots(RULES, plain, new Set([2]), 'ring')).toEqual([1, 3, 4, 5, 6]);
    expect(freeSpots(RULES, plain, new Set(), 'edge')).toEqual([]);
    expect(fitsSlot('centre', 0)).toBe(true);
    expect(fitsSlot('centre', 3)).toBe(false);
    expect(fitsSlot('ring', 0)).toBe(false);
    expect(fitsSlot('ring', 6)).toBe(true);
    expect(fitsSlot('edge', 0)).toBe(false);
  });
});

describe('Fuel all fires (#202)', () => {
  const ember = (id: string, nightsLeft: number) => ({
    id,
    fuelResource: 'emberwood',
    fuelPerNight: 1,
    nightsLeft,
    space: 5 - nightsLeft,
  });

  it('fills every fire when the bag has enough', () => {
    const plan = planFuelAll([ember('a', 4), ember('b', 1), ember('c', 5)], { emberwood: 50 });
    expect(Object.fromEntries(plan)).toEqual({ a: 1, b: 4 });
  });

  it('gives the lowest fire a night first, one night at a time, when the bag runs short', () => {
    const plan = planFuelAll([ember('a', 2), ember('b', 0), ember('c', 1)], { emberwood: 4 });
    // b 0→1, b/c 1→2 (b first by id), c 1→2, then a/b/c all at 2: a gets the last.
    expect(Object.fromEntries(plan)).toEqual({ a: 1, b: 2, c: 1 });
    expect(planFuelAll([ember('a', 0)], { emberwood: 0 }).size).toBe(0);
  });

  it('pays each fire from its own fuel', () => {
    const odd = { ...ember('z', 0), fuelResource: 'pumpkins', fuelPerNight: 2 };
    const plan = planFuelAll([ember('a', 3), odd], { emberwood: 1, pumpkins: 5 });
    expect(Object.fromEntries(plan)).toEqual({ a: 1, z: 2 });
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
    expect(upgradeCost(fire, 2)).toEqual({ timber: 20, stone: 15, glimmer: 1 });
    expect(upgradeCost(fire, 3)).toBeNull();
    expect(upgradeCost(lantern, 1)).toBeNull();
    expect(upgradeCost(building('cozy-meadow'), 1)).toEqual({ timber: 8, stone: 4 });
    // What an upgraded building cost in all is what a take-down refunds from.
    expect(spentOn(fire, 3)).toEqual({ timber: 35, stone: 30, glimmer: 1 });
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

  it('lets players build fires, habitats, Training Grounds, the Factory and fences', () => {
    expect(BUILDINGS.filter((b) => isBuildable(RULES, b)).map((b) => b.id)).toEqual([
      'hearthfire',
      'jack-o-lantern-hearthfire',
      'ember-den',
      'cozy-meadow',
      'training-grounds',
      'crafting-factory',
      'hedge',
      'moat',
      'stone-wall',
      'emberwood-palisade',
      'glimmer-rail',
      'lantern-fence',
      'bramble-hedge',
      'ice-wall',
    ]);
  });

  it('lets a Hearthfire stand on owned land, one a tile, in the middle (#202, #204)', () => {
    // Only on captured land: the Heart Seed keeps home safe (owner decision 2026-10-07).
    expect(fire).toMatchObject({ placement: 'land', maxPerTile: 1, slot: 'centre' });
    expect(lantern).toMatchObject({ placement: 'land', maxPerTile: 1, slot: 'centre' });
    for (const id of ['ember-den', 'cozy-meadow']) {
      expect(building(id)).toMatchObject({ placement: 'home', slot: 'ring' });
    }
    const loose = { ...GAME_DATA, buildings: [{ ...fire, maxPerTile: undefined }] };
    expect(checkGameData(loose).join(' ')).toContain('maxPerTile');
    const homeless = { ...GAME_DATA, buildings: [{ ...fire, placement: 'owned' as const }] };
    expect(checkGameData(homeless).join(' ')).toContain('maxPerHome');
  });

  it('puts Training Grounds on homesteads only, one a tile, around the middle (#277)', () => {
    const grounds = building('training-grounds');
    expect(grounds).toMatchObject({ placement: 'homestead', maxPerTile: 1, slot: 'ring' });
    expect(buildsAtHome(grounds)).toBe(false);
    // A homestead building needs no home count, but does need a tile cap.
    expect(checkGameData({ ...GAME_DATA, buildings: [grounds] })).toEqual([]);
    const loose = { ...GAME_DATA, buildings: [{ ...grounds, maxPerTile: undefined }] };
    expect(checkGameData(loose).join(' ')).toContain('maxPerTile');
  });

  it('names the carved pumpkin apart from the fire built from it', () => {
    const item = GAME_DATA.resources.find((r) => r.id === 'jack-o-lantern-hearthfire');
    expect(item?.name).toBe("Jack-o'-Lantern");
    expect(lantern.name).toBe("Jack-o'-Lantern Hearthfire");
  });
});
