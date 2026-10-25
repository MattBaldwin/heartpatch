import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { TERRAINS } from '../data/terrains.js';
import { TERRITORY_RULES } from '../data/territory.js';
import { TRAVEL_RULES } from '../data/travel.js';
import { WEATHER_RULES } from '../data/weather.js';
import { buildsOnPatchType, WILD_ISLE_BUILDING_KINDS } from '../schemas/data/buildings.js';
import { isBuildable } from '../schemas/data/home-base.js';
import { isWater } from '../schemas/data/terrains.js';
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
  it('are Cozy Patch and Wild Isle, cozy by default', () => {
    expect(PatchTypeSchema.options).toEqual(['cozy', 'wild-isle']);
    expect(DEFAULT_PATCH_TYPE).toBe('cozy');
    const request = { name: 'Pumpkin Hollow', timeZone: 'Europe/London' };
    expect(CreateMapRequestSchema.parse(request).patchType).toBeUndefined();
    expect(CreateMapRequestSchema.parse({ ...request, patchType: 'wild-isle' }).patchType).toBe(
      'wild-isle',
    );
    expect(() => CreateMapRequestSchema.parse({ ...request, patchType: 'volcano' })).toThrow();
  });

  it('keeps a Cozy Patch on exactly today’s rules', () => {
    expect(patchRules('cozy')).toEqual({
      patchType: 'cozy',
      terrains: TERRAINS.filter((t) => COZY_TERRAINS.includes(t.id)),
      territory: TERRITORY_RULES,
      travel: null,
      weather: null,
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
  });

  it('never offers a Wild Isle building on a Cozy Patch', () => {
    const wildKinds: readonly string[] = WILD_ISLE_BUILDING_KINDS;
    const wildBuildings = BUILDINGS.filter((b) => wildKinds.includes(b.kind));
    expect(wildBuildings.map((b) => b.id)).toEqual([
      'bridge',
      'waystation',
      'ferry-dock',
      'river-well',
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
      // Not buildable anywhere yet: each kind joins with the lane that builds it.
      expect(isBuildable(HOME_BASE_RULES, b, 'wild-isle'), b.id).toBe(false);
    }
  });

  it('leaves every Cozy building buildable exactly as before, on both types', () => {
    for (const b of BUILDINGS.filter((b) => b.patchTypes === undefined)) {
      expect(isBuildable(HOME_BASE_RULES, b, 'cozy')).toBe(isBuildable(HOME_BASE_RULES, b));
      expect(isBuildable(HOME_BASE_RULES, b, 'wild-isle')).toBe(isBuildable(HOME_BASE_RULES, b));
    }
  });
});
