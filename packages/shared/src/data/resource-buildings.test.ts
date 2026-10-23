import { describe, expect, it } from 'vitest';
import { checkResourceBuildings, paysUpkeep, type Building } from '../schemas/data/buildings.js';
import { isBuildable } from '../schemas/data/home-base.js';
import { BUILDINGS } from './buildings.js';
import { HOME_BASE_RULES } from './home-base.js';
import { JOB_RULES } from './jobs.js';
import { RESOURCE_BUILDING_RULES } from './resource-buildings.js';

const economy = BUILDINGS.filter(paysUpkeep);

describe('resource buildings and the Warehouse (#601)', () => {
  it('pass their checks, and a broken one is caught', () => {
    expect(checkResourceBuildings(BUILDINGS, RESOURCE_BUILDING_RULES, JOB_RULES)).toEqual([]);
    expect(
      checkResourceBuildings(BUILDINGS, { warehouseDeliversFromLevel: 0 }, JOB_RULES).join('\n'),
    ).toMatch(/warehouseDeliversFromLevel/);

    const hut = economy.find((b) => b.id === 'stone-quarry');
    if (hut?.kind !== 'resource') throw new Error('no Stone Quarry');
    const broken: Building[] = [
      ...BUILDINGS,
      { ...hut, id: 'second-quarry' },
      { ...hut, id: 'gap-hut', terrain: 'juniper-gap', placement: 'owned' },
      { ...hut, id: 'shrinking', terrain: 'nowhere', levels: [...hut.levels].reverse() },
    ];
    const problems = checkResourceBuildings(broken, RESOURCE_BUILDING_RULES, JOB_RULES).join('\n');
    expect(problems).toMatch(/second-quarry.terrain: a second building for "hills"/);
    expect(problems).toMatch(/gap-hut.terrain: "juniper-gap" has no land yield/);
    expect(problems).toMatch(/gap-hut: a homestead building/);
    expect(problems).toMatch(/shrinking.levels.1: holds less/);
  });

  it('has one building for every land with a yield, and one Warehouse', () => {
    const terrains = economy.flatMap((b) => (b.kind === 'resource' ? [b.terrain] : []));
    expect([...terrains].sort()).toEqual(JOB_RULES.terrainYields.map((y) => y.terrain).sort());
    expect(economy.filter((b) => b.kind === 'warehouse').map((b) => b.id)).toEqual(['warehouse']);
  });

  it('builds the resource buildings (PR 7) and the Warehouse (PR 9)', () => {
    for (const b of economy) {
      expect(isBuildable(HOME_BASE_RULES, b), b.id).toBe(true);
    }
  });
});
