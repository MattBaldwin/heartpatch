import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { PATCH_TYPE_RULES } from '../data/patch-types.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { TERRAINS } from '../data/terrains.js';
import { TERRITORY_RULES } from '../data/territory.js';
import { TRAVEL_RULES } from '../data/travel.js';
import { WEATHER_RULES } from '../data/weather.js';
import { POWER_RULES } from '../data/power.js';
import { RAIL_RULES } from '../data/rails.js';
import { RESEARCH_TREE } from '../data/research.js';
import {
  buildsOnPatchType,
  CLOCKWORK_BUILDING_KINDS,
  WILD_ISLE_BUILDING_KINDS,
} from '../schemas/data/buildings.js';
import { isBuildable } from '../schemas/data/home-base.js';
import { isWater } from '../schemas/data/terrains.js';
import { isBuildableOn } from '../home/water-works.js';
import { CreateMapRequestSchema } from '../schemas/maps.js';
import { DEFAULT_PATCH_TYPE, PatchTypeSchema, patchRules } from './index.js';

/** Today's Cozy terrains, as they were before Wild Isle (#621). */
const COZY_TERRAINS = [
  'meadow',
  'forest',
  'old-forest',
  'hills',
  'mountains',
  'lake',
  'pumpkin-fields',
  'trading-post',
  'clearing',
  'junipers-gap',
];

describe('patch types (#621)', () => {
  it('are Cozy Patch, Wild Isle and Clockwork Isle, cozy by default', () => {
    expect(PatchTypeSchema.options).toEqual(['cozy', 'wild-isle', 'clockwork-isle']);
    expect(DEFAULT_PATCH_TYPE).toBe('cozy');
    const request = { name: 'Pumpkin Hollow', timeZone: 'Europe/London' };
    expect(CreateMapRequestSchema.parse(request).patchType).toBeUndefined();
    expect(CreateMapRequestSchema.parse({ ...request, patchType: 'wild-isle' }).patchType).toBe(
      'wild-isle',
    );
    expect(
      CreateMapRequestSchema.parse({ ...request, patchType: 'clockwork-isle' }).patchType,
    ).toBe('clockwork-isle');
    expect(() => CreateMapRequestSchema.parse({ ...request, patchType: 'volcano' })).toThrow();
  });

  it('only leaves out terrains that exist', () => {
    const ids = new Set(TERRAINS.map((t) => t.id));
    for (const type of PatchTypeSchema.options) {
      for (const id of PATCH_TYPE_RULES[type].excludedTerrains)
        expect(ids, `${type}: ${id}`).toContain(id);
    }
  });

  it('keeps a Cozy Patch on exactly today’s rules', () => {
    expect(patchRules('cozy')).toEqual({
      patchType: 'cozy',
      terrains: TERRAINS.filter((t) => COZY_TERRAINS.includes(t.id)),
      territory: TERRITORY_RULES,
      travel: null,
      weather: null,
      power: null,
      rails: null,
      research: null,
    });
    expect(patchRules('cozy').terrains.map((t) => t.id)).toEqual(COZY_TERRAINS);
    expect(patchRules('cozy').territory).toBe(TERRITORY_RULES);
  });

  it('gives a Wild Isle water, coast, travel and weather, and no claimable lakes', () => {
    const wild = patchRules('wild-isle');
    expect(wild.terrains.map((t) => t.id)).toEqual([
      ...COZY_TERRAINS.filter((id) => id !== 'lake'),
      'ocean',
      'river',
      'wild-lake',
      'coast',
    ]);
    expect(wild.terrains.filter(isWater).map((t) => t.water)).toEqual(['deep', 'river', 'lake']);
    expect(wild.territory).toBe(TERRITORY_RULES);
    expect(wild.travel).toBe(TRAVEL_RULES);
    expect(wild.weather).toBe(WEATHER_RULES);
    // No Clockwork rules on a Wild Isle (#874).
    expect([wild.power, wild.rails, wild.research]).toEqual([null, null, null]);
  });

  it("gives a Clockwork Isle a Wild Isle's land and travel, power, rails and research, and no weather (#874)", () => {
    const clockwork = patchRules('clockwork-isle');
    expect(clockwork.terrains).toEqual(patchRules('wild-isle').terrains);
    expect(clockwork.territory).toBe(TERRITORY_RULES);
    expect(clockwork.travel).toBe(TRAVEL_RULES);
    expect(clockwork.weather).toBeNull();
    expect(clockwork.power).toBe(POWER_RULES);
    expect(clockwork.rails).toBe(RAIL_RULES);
    expect(clockwork.research).toBe(RESEARCH_TREE);
    // Owner answer Q3: wires like roads.
    expect(POWER_RULES.model).toBe('wires');
  });

  it('only offers a Clockwork Isle building on a Clockwork Isle (#874)', () => {
    const clockwork = BUILDINGS.filter(
      (b) => b.patchTypes?.length === 1 && b.patchTypes[0] === 'clockwork-isle',
    );
    expect(clockwork.map((b) => b.id)).toEqual([
      'windmill',
      'sorter',
      'research-bench',
      'rail-depot',
      'clockwork-beacon',
      'gift-wrapper',
    ]);
    for (const b of BUILDINGS) {
      const kinds: readonly string[] = CLOCKWORK_BUILDING_KINDS;
      if (kinds.includes(b.kind)) expect(b.patchTypes, b.id).toEqual(['clockwork-isle']);
    }
    for (const b of clockwork) {
      for (const type of ['cozy', 'wild-isle'] as const) {
        expect(buildsOnPatchType(b, type), b.id).toBe(false);
        expect(isBuildableOn(HOME_BASE_RULES, b, type), b.id).toBe(false);
      }
      expect(isBuildableOn(HOME_BASE_RULES, b, 'clockwork-isle'), b.id).toBe(true);
      // The Beacon is a `lights` row: buildable through `buildableKinds` like
      // Twinkle Lights (#37 2a), still only on its patch type.
      if (b.kind === 'lights') continue;
      // Never through `buildableKinds`, so the client's kind names stay whole.
      expect(isBuildable(HOME_BASE_RULES, b, 'clockwork-isle'), b.id).toBe(false);
    }
  });

  it('never offers a Wild Isle building on a Cozy Patch', () => {
    const wildKinds: readonly string[] = WILD_ISLE_BUILDING_KINDS;
    const wildBuildings = BUILDINGS.filter(
      (b) =>
        wildKinds.includes(b.kind) &&
        !(b.kind === 'works' && b.patchTypes?.[0] === 'clockwork-isle'),
    );
    expect(wildBuildings.map((b) => b.id)).toEqual([
      'bridge',
      'waystation',
      'ferry-dock',
      'river-well',
      // W1-8's water works.
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
    // As if every kind were buildable: the patch type alone still hides them.
    const everyKind = {
      ...HOME_BASE_RULES,
      buildableKinds: [...new Set(BUILDINGS.map((b) => b.kind))],
    } as unknown as typeof HOME_BASE_RULES;
    for (const b of wildBuildings) {
      expect(buildsOnPatchType(b, 'cozy'), b.id).toBe(false);
      expect(buildsOnPatchType(b, 'wild-isle'), b.id).toBe(true);
      expect(isBuildable(everyKind, b), b.id).toBe(false);
      expect(isBuildable(everyKind, b, 'cozy'), b.id).toBe(false);
      expect(isBuildable(everyKind, b, 'wild-isle'), b.id).toBe(true);
      // Never through `buildableKinds`: the server builds them by the map's
      // patch type (`isBuildableOn`), so the client's kind names stay whole.
      expect(isBuildable(HOME_BASE_RULES, b, 'wild-isle'), b.id).toBe(false);
      expect(isBuildableOn(HOME_BASE_RULES, b, 'cozy'), b.id).toBe(false);
      expect(isBuildableOn(HOME_BASE_RULES, b, 'wild-isle'), b.id).toBe(b.id !== 'waystation');
    }
  });

  it('lets a Bridge cross a Clockwork Isle river, and no other Wild Isle building (#874)', () => {
    const both = BUILDINGS.filter(
      (b) => buildsOnPatchType(b, 'wild-isle') && buildsOnPatchType(b, 'clockwork-isle'),
    );
    expect(both.filter((b) => b.patchTypes !== undefined).map((b) => b.id)).toEqual(['bridge']);
    expect(
      isBuildableOn(
        HOME_BASE_RULES,
        BUILDINGS.find((b) => b.id === 'bridge')!,
        'clockwork-isle',
      ),
    ).toBe(true);
  });

  it('leaves every Cozy building buildable exactly as before, on every type', () => {
    for (const b of BUILDINGS.filter((b) => b.patchTypes === undefined)) {
      for (const type of PatchTypeSchema.options) {
        expect(isBuildable(HOME_BASE_RULES, b, type)).toBe(isBuildable(HOME_BASE_RULES, b));
      }
    }
  });
});
