import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { JOB_RULES } from '../data/jobs.js';
import { RESOURCE_BUILDING_RULES } from '../data/resource-buildings.js';
import { BuildingSchema, type Building } from '../schemas/data/buildings.js';
import { buildingEffects, economyEffects } from './building-effects.js';

const byId = (id: string): Building => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`no building ${id}`);
  return b;
};

describe('buildingEffects (#207)', () => {
  it('says a Hearthfire keeps tiles around it safe and needs fuel, per level', () => {
    const fire = byId('hearthfire');
    expect(buildingEffects(fire)).toEqual([
      { kind: 'safe', radius: 1 },
      { kind: 'fuel', perNight: 1 },
    ]);
    expect(buildingEffects(fire, 2)[0]).toEqual({ kind: 'safe', radius: 1 });
    // Past the last level reads as the last one.
    expect(buildingEffects(fire, 99)[0]).toEqual({ kind: 'safe', radius: 2 });
    expect(buildingEffects(byId('jack-o-lantern-hearthfire'))[0]).toEqual({
      kind: 'safe',
      radius: 1,
    });
  });

  it('says who grows faster in a habitat and how many live there', () => {
    expect(buildingEffects(byId('ember-den'))).toEqual([
      { kind: 'grows', elements: ['fire'], feelings: ['cozy'] },
      { kind: 'room', capacity: 3 },
    ]);
    expect(buildingEffects(byId('cozy-meadow'), 2)[1]).toEqual({ kind: 'room', capacity: 5 });
  });

  it('says how many train at once and how fast', () => {
    expect(buildingEffects(byId('training-grounds'))).toEqual([
      { kind: 'training', capacity: 2, xpPerHour: 5 },
    ]);
  });

  it('says how many batches the Crafting Factory runs at once, per level (#294)', () => {
    const factory = byId('crafting-factory');
    expect(buildingEffects(factory)).toEqual([{ kind: 'batches', queues: 2 }]);
    expect(buildingEffects(factory, 2)).toEqual([{ kind: 'batches', queues: 3 }]);
    expect(buildingEffects(factory, 3)).toEqual([{ kind: 'batches', queues: 4 }]);
  });

  it('works for a new building from its data alone', () => {
    const pond = BuildingSchema.parse({
      id: 'splash-pond',
      kind: 'habitat',
      name: 'Splash Pond',
      description: 'A cool pond. Water squishies grow faster here.',
      maxPerHome: 1,
      placement: 'home',
      slot: 'ring',
      tags: { elements: ['water'], feelings: [] },
      levels: [{ cost: { stone: 4 }, capacity: 4 }],
    });
    expect(buildingEffects(pond)).toEqual([
      { kind: 'grows', elements: ['water'], feelings: [] },
      { kind: 'room', capacity: 4 },
    ]);
  });

  it('gives every building in the data at least one effect', () => {
    for (const b of BUILDINGS) {
      const effects = [...buildingEffects(b), ...economyEffects(b, 1, RULES)];
      expect(effects.length, b.id).toBeGreaterThan(0);
    }
  });
});

const RULES = {
  jobs: JOB_RULES,
  explore: EXPLORE_RULES,
  resourceBuildings: RESOURCE_BUILDING_RULES,
} as const;

describe('economyEffects (#601)', () => {
  it('says what a resource building makes an hour, holds and costs a morning, per level', () => {
    const hut = byId('woodcutters-hut');
    // Forest: 2 Timber a 15-minute gather, +1 on a homestead; a cycle is
    // 15 min × 200 % ÷ 300 % = 10 min, so 3 Timber every 10 minutes.
    expect(economyEffects(hut, 1, RULES)).toEqual([
      { kind: 'produces', resource: 'timber', perHour: 18, storageHours: 24, upkeep: 17 },
    ]);
    expect(economyEffects(hut, 3, RULES)[0]).toMatchObject({ perHour: 24, storageHours: 72 });
    // Past the last level reads as the last.
    expect(economyEffects(hut, 99, RULES)).toEqual(economyEffects(hut, 4, RULES));
    // The old building kinds have none, and the resource kinds no plain chips.
    expect(economyEffects(byId('hearthfire'), 1, RULES)).toEqual([]);
    expect(buildingEffects(hut)).toEqual([]);
  });

  it('says from which level the Warehouse delivers, and its upkeep', () => {
    expect(economyEffects(byId('warehouse'), 1, RULES)).toEqual([
      {
        kind: 'delivers',
        fromLevel: RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel,
        upkeep: 30,
      },
    ]);
  });
});
