import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { JOB_RULES } from '../data/jobs.js';
import { RESOURCE_BUILDING_RULES } from '../data/resource-buildings.js';
import { BuildingSchema, type Building } from '../schemas/data/buildings.js';
import {
  GUIDE_GROUPS,
  buildingGuide,
  buildingsGuide,
  type BuildingGuideContext,
} from './building-guide.js';

const ECONOMY = {
  jobs: JOB_RULES,
  explore: EXPLORE_RULES,
  resourceBuildings: RESOURCE_BUILDING_RULES,
};
const ctx = (over: Partial<BuildingGuideContext> = {}): BuildingGuideContext => ({
  patchType: 'wild-isle',
  seasons: ['halloween'],
  rules: HOME_BASE_RULES,
  economy: ECONOMY,
  ...over,
});
const def = (id: string): Building => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(id);
  return b;
};
const guide = (id: string, over: Partial<BuildingGuideContext> = {}) => {
  const g = buildingGuide(def(id), ctx(over));
  if (!g) throw new Error(`${id} not in the guide`);
  return g;
};
const kinds = (xs: readonly { kind: string }[]) => xs.map((x) => x.kind);

describe('buildingGuide (#715)', () => {
  it('hearthfire: keeps squishies safe, burns fuel, on my land, one a tile', () => {
    const g = guide('hearthfire');
    expect(g.group).toBe('fires');
    expect(g.value).toContainEqual({ kind: 'safe', radius: 1 });
    expect(kinds(g.value)).toContain('fuel');
    expect(g.place).toContainEqual({ kind: 'placement', placement: 'land' });
    expect(g.place).toContainEqual({ kind: 'per-tile', max: 1 });
    expect(g.gate).toBeNull();
  });

  it('a lantern gives everything back when packed up', () => {
    expect(guide('joy-lantern').value).toContainEqual({ kind: 'refund-all' });
  });

  it('habitat: room and who grows faster, at home, up to its home cap', () => {
    const g = guide('ember-den');
    expect(g.group).toBe('home');
    expect(kinds(g.value)).toEqual(expect.arrayContaining(['room', 'grows']));
    expect(g.place).toContainEqual({ kind: 'placement', placement: 'home' });
    expect(g.place).toContainEqual({ kind: 'per-home', max: 4, atHome: true });
    expect(kinds(g.place)).not.toContain('per-tile');
  });

  it('training grounds and the factory are helpers', () => {
    expect(guide('training-grounds').group).toBe('helpers');
    expect(kinds(guide('training-grounds').value)).toContain('training');
    const factory = guide('crafting-factory');
    expect(factory.group).toBe('helpers');
    expect(kinds(factory.value)).toContain('batches');
    expect(factory.place).toContainEqual({ kind: 'per-home', max: 1, atHome: false });
  });

  it('fence: energy, on edges, priced per edge', () => {
    const g = guide('hedge');
    expect(g.group).toBe('fences');
    expect(kinds(g.value)).toContain('fence');
    expect(kinds(g.place)).toContain('edges');
    expect(g.cost).toEqual(def('hedge').levels[0]?.cost);
    expect(g.levels).toEqual(def('hedge').levels.map((l) => l.cost));
  });

  it('resource: what it makes an hour, on its own terrain', () => {
    const g = guide('greenhouse');
    expect(g.group).toBe('resources');
    expect(g.value.find((v) => v.kind === 'produces')).toMatchObject({ resource: 'greens' });
    expect(kinds(g.value)).toContain('weatherproof');
    expect(g.place).toContainEqual({ kind: 'terrain', terrain: 'meadow' });
  });

  it('leaves out a resource building whose land the patch never has', () => {
    const lake = BUILDINGS.filter((b) => b.kind === 'resource' && b.terrain === 'lake');
    expect(lake.length).toBeGreaterThan(0);
    for (const b of lake) expect(buildingGuide(b, ctx())).toBeNull();
    for (const b of lake) expect(buildingGuide(b, ctx({ patchType: 'cozy' }))).not.toBeNull();
  });

  it('warehouse: delivers to the bag', () => {
    expect(kinds(guide('warehouse').value)).toContain('delivers');
  });

  it('works: makes, eats, and needs its water next door (in where, not why)', () => {
    const g = guide('watermill');
    expect(g.group).toBe('water');
    expect(kinds(g.value)).toEqual(expect.arrayContaining(['produces', 'eats']));
    expect(kinds(g.value)).not.toContain('needs-water');
    expect(kinds(g.place)).toContain('needs-water');
    expect(g.place).toContainEqual({ kind: 'patch', patchTypes: ['wild-isle'] });
  });

  it('canal carries water; shelters keep storms off; the vane forecasts', () => {
    expect(kinds(guide('canal').value)).toContain('carries-water');
    expect(guide('canal').group).toBe('water');
    expect(guide('levee').group).toBe('shelters');
    expect(kinds(guide('levee').value)).toContain('shelters');
    expect(guide('weather-vane').group).toBe('helpers');
    expect(kinds(guide('weather-vane').value)).toContain('forecast');
  });

  it('travel: a bridge stands on the river; a dock needs a lake', () => {
    const bridge = guide('bridge');
    expect(bridge.group).toBe('travel');
    expect(bridge.place[0]).toEqual({ kind: 'on-water', water: 'river' });
    expect(bridge.value).toContainEqual({ kind: 'travel', role: 'bridge' });
    expect(kinds(guide('ferry-dock').place)).toContain('needs-water');
  });

  it('the waystation waits on the shelf: in the data, not in the game yet', () => {
    const g = guide('waystation');
    expect(g.gate).toEqual({ kind: 'not-yet' });
    expect(g.value).toContainEqual({ kind: 'travel', role: 'waystation', reach: 3 });
  });

  it('a seasonal building out of its season waits for next time', () => {
    expect(guide('pumpkin-barn', { patchType: 'cozy' }).gate).toBeNull();
    expect(guide('pumpkin-barn', { patchType: 'cozy', seasons: [] }).gate).toEqual({
      kind: 'season',
      season: 'halloween',
    });
    expect(kinds(guide('pumpkin-barn', { patchType: 'cozy' }).place)).toContain('season');
  });

  it('a Cozy Patch never lists a Wild Isle building', () => {
    const cozy = buildingsGuide(BUILDINGS, ctx({ patchType: 'cozy' }));
    expect(cozy.map((e) => e.id)).not.toContain('watermill');
    expect(cozy.map((e) => e.id)).not.toContain('waystation');
  });

  it('lists shelf by shelf, and every building is in some patch type', () => {
    for (const patchType of ['cozy', 'wild-isle'] as const) {
      const all = buildingsGuide(BUILDINGS, ctx({ patchType }));
      const order = all.map((e) => GUIDE_GROUPS.indexOf(e.group));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
    const ids = new Set(
      (['cozy', 'wild-isle'] as const).flatMap((patchType) =>
        buildingsGuide(BUILDINGS, ctx({ patchType })).map((e) => e.id),
      ),
    );
    expect(BUILDINGS.filter((b) => !ids.has(b.id)).map((b) => b.id)).toEqual([]);
  });

  it('a new building shows up with no guide code (rule 5)', () => {
    const shed = BuildingSchema.parse({
      id: 'tool-shed',
      name: 'Tool Shed',
      description: 'A tidy shed.',
      kind: 'factory',
      placement: 'homestead',
      maxPerHome: 2,
      maxPerTile: 1,
      slot: 'centre',
      levels: [{ cost: { timber: 3 }, queues: 1 }],
    });
    const all = buildingsGuide([...BUILDINGS, shed], ctx());
    expect(all.find((e) => e.id === 'tool-shed')).toMatchObject({
      name: 'Tool Shed',
      group: 'helpers',
      cost: { timber: 3 },
      gate: null,
    });
  });
});
