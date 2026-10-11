import { describe, expect, it } from 'vitest';
import { searchSpots } from '../../explore/index.js';
import { workSource } from '../../jobs/index.js';
import { extraNodes } from '../../mapgen/extra-nodes.js';
import { deriveSeed } from '../../rng/index.js';
import { resolveWildSpawn } from '../../spawns/resolve.js';
import { spawnWindowAt } from '../../spawns/window.js';
import { resolveGuardians } from '../../territory/guardians.js';
import { GROWTH_RULES } from '../care.js';
import { EXPLORE_RULES } from '../explore.js';
import { JOB_RULES } from '../jobs.js';
import { RESOURCES } from '../resources.js';
import { SEASONS } from '../seasons.js';
import { SPECIES } from '../species.js';
import { TERRAINS } from '../terrains.js';
import { GUARDIAN_RULES } from './guardian-rules.js';
import { SECRET_SPECIES } from './secret-species.js';
import { SPAWN_RULES } from './spawn-rules.js';
import { SPAWN_TABLES } from './spawn-tables.js';

// Cleared land (#242) is a terrain on the tile row, so every reader of a
// tile's terrain treats a cleared tile through data alone. One check per
// reader (the coordinator's condition on the #295 plan).

const CLEARING = TERRAINS.find((t) => t.id === 'clearing');
const tile = { q: 3, r: -1, terrain: 'clearing', homeSlot: null, nodeResource: null };
const species = new Map([...SPECIES, ...SECRET_SPECIES].map((s) => [s.id, s]));
const day = spawnWindowAt({ date: '2026-08-12', hour: 12 }, SPAWN_RULES.windowHours);

describe('cleared land (#242)', () => {
  it('is a terrain the generator never places and that holds no nodes', () => {
    expect(CLEARING).toMatchObject({ weight: 0, nodeChance: 0, nodeResources: [] });
    expect(CLEARING?.extraNodes).toBeUndefined();
  });

  it("never gets a node back from the extra-node pass (#238's extraNodes)", () => {
    expect(extraNodes([tile], TERRAINS, 'any-seed')).toEqual([]);
  });

  it('gives a gatherer nothing: no land yield, no spot', () => {
    expect(JOB_RULES.terrainYields.some((y) => y.terrain === 'clearing')).toBe(false);
    expect(workSource(tile, RESOURCES, JOB_RULES)).toBeNull();
  });

  it('has nothing left to explore', () => {
    expect(searchSpots('any-seed', tile, EXPLORE_RULES)).toBeNull();
  });

  it('spawns wild squishies from the everyday meadow table', () => {
    const meadow = SPAWN_TABLES.find((t) => t.id === 'meadow');
    expect(meadow?.terrains).toContain('clearing');
    const data = {
      tables: SPAWN_TABLES,
      species,
      seasons: SEASONS,
      rules: { ...SPAWN_RULES, chance: 100 },
      maxLevel: GROWTH_RULES.maxLevel,
    };
    const found = Array.from({ length: 40 }, (_, q) =>
      resolveWildSpawn({ seed: deriveSeed('map', 'spawn', q, 0, day.id), terrain: 'clearing', window: day }, data),
    );
    const everyday = new Set(meadow?.entries.map((e) => e.species));
    expect(found.every((s) => s !== null && everyday.has(s.speciesId))).toBe(true);
  });

  it("is guarded by the meadow's guardians", () => {
    const team = resolveGuardians(
      { seed: deriveSeed('map', 'guardian', 3, -1, day.id), terrain: 'clearing', strength: 2, window: day },
      { rules: GUARDIAN_RULES, species, seasons: SEASONS },
    );
    const meadow = GUARDIAN_RULES.tables.find((t) => t.id === 'meadow-guardians');
    expect(meadow?.terrains).toContain('clearing');
    expect(team.length).toBeGreaterThan(0);
  });
});
