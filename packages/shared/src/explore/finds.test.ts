import { describe, expect, it } from 'vitest';
import { EXPLORE_RULES } from '../data/explore.js';
import { GAME_DATA } from '../data/index.js';
import { EXPLORE_FINDS } from '../data/server/explore-finds.js';
import { LORE_PAGES } from '../data/server/lore-pages.js';
import { Rng } from '../rng/index.js';
import { checkExploreFinds, type ExploreFindTable } from '../schemas/data/explore-finds.js';
import { exploreFindTable, rollExploreFind } from './finds.js';

const pages = LORE_PAGES.map((p) => p.id);

describe('explore find tables', () => {
  it('pass their own checks', () => {
    expect(checkExploreFinds(EXPLORE_FINDS, GAME_DATA, EXPLORE_RULES, pages)).toEqual([]);
  });

  it('report unknown kinds, items, terrains and pages, seasonal items and tools', () => {
    const broken: ExploreFindTable[] = [
      ...EXPLORE_FINDS.filter((t) => t.kind !== 'cave'),
      { kind: 'puddle', finds: [{ weight: 1 }] },
      { kind: 'rock', terrains: ['moon'], finds: [{ weight: 1, items: { gold: 1 } }] },
      { kind: 'tree', terrains: ['forest'], finds: [{ weight: 1, items: { pumpkins: 1 } }] },
      { kind: 'mound', terrains: ['meadow'], finds: [{ weight: 1, items: { shovel: 1 } }] },
      { kind: 'ledge', terrains: ['hills'], finds: [{ weight: 1, lore: 'no-such-page' }] },
    ];
    expect(checkExploreFinds(broken, GAME_DATA, EXPLORE_RULES, pages)).toEqual(
      expect.arrayContaining([
        'finds[17]: unknown spot kind "puddle"',
        'finds[18]: unknown terrain "moon"',
        'finds[18].finds[0]: unknown item "gold"',
        'finds[19].finds[0]: "pumpkins" can\'t be found exploring',
        'finds[20].finds[0]: "shovel" can\'t be found exploring',
        'finds[21].finds[0]: unknown lore page "no-such-page"',
        'spot kind "cave" has no find table',
      ]),
    );
  });

  it('refuse a find that is items and a page at once', () => {
    const both = [{ kind: 'rock', finds: [{ weight: 1, items: { stone: 1 }, lore: 'x' }] }];
    expect(checkExploreFinds(both, GAME_DATA, EXPLORE_RULES, pages)).not.toEqual([]);
  });
});

describe('coast find tables (#621 W1-11)', () => {
  const coast = EXPLORE_RULES.terrains.find((t) => t.terrain === 'coast');

  it('has a table with positive weights for every coast spot', () => {
    expect(coast?.kinds.length).toBeGreaterThan(0);
    for (const { kind } of coast?.kinds ?? []) {
      const table = exploreFindTable(EXPLORE_FINDS, kind, 'coast');
      expect(table, kind).toBeDefined();
      for (const f of table?.finds ?? []) expect(f.weight, kind).toBeGreaterThan(0);
    }
  });

  it('turns up fish from the Snorkel spots and the Shovel’s crab hole, and stays small', () => {
    for (const kind of ['tide-pool', 'kelp-bed', 'crab-hole']) {
      const table = exploreFindTable(EXPLORE_FINDS, kind, 'coast');
      expect(
        table?.finds.some((f) => (f.items?.['fish'] ?? 0) > 0),
        kind,
      ).toBe(true);
      // A find is small next to a gather (a node gives 2–5 a gather, #199).
      for (const f of table?.finds ?? []) {
        for (const n of Object.values(f.items ?? {})) expect(n, kind).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps its odds server-side: the public rules carry only names and tools', () => {
    const publicRules = JSON.stringify(EXPLORE_RULES);
    expect(publicRules).not.toContain('fish');
    expect(publicRules).not.toContain('heartdust');
  });
});

describe('rollExploreFind', () => {
  const tables: ExploreFindTable[] = [
    { kind: 'rock', finds: [{ weight: 1, items: { stone: 1 } }] },
    { kind: 'rock', terrains: ['hills'], finds: [{ weight: 1, items: { stone: 3 } }] },
    { kind: 'cave', finds: [{ weight: 1, lore: 'page' }] },
  ];

  it('uses the terrain’s own table before the general one', () => {
    expect(exploreFindTable(tables, 'rock', 'hills')?.terrains).toEqual(['hills']);
    expect(exploreFindTable(tables, 'rock', 'meadow')?.terrains).toBeUndefined();
    const rng = Rng.fromSeed('finds');
    expect(rollExploreFind(tables, { kind: 'rock', terrain: 'hills' }, rng, new Set())).toEqual({
      items: { stone: 3 },
      lore: null,
    });
  });

  it('finds a lore page once, then nothing in its place', () => {
    const rng = Rng.fromSeed('finds');
    expect(rollExploreFind(tables, { kind: 'cave', terrain: 'hills' }, rng, new Set())).toEqual({
      items: {},
      lore: 'page',
    });
    expect(
      rollExploreFind(tables, { kind: 'cave', terrain: 'hills' }, rng, new Set(['page'])),
    ).toEqual({ items: {}, lore: null });
  });

  it('is the same for the same roll, and covers every kind the rules use', () => {
    for (const kind of EXPLORE_RULES.spotKinds) {
      const roll = () =>
        rollExploreFind(
          EXPLORE_FINDS,
          { kind: kind.id, terrain: 'meadow' },
          Rng.fromSeed(kind.id),
          new Set(),
        );
      expect(roll()).toEqual(roll());
    }
  });
});

describe('Glimmer from exploring (#523)', () => {
  /** Glimmer a search spot gives on average on a terrain, from its kit's weights. */
  function glimmerPerSpot(terrain: string): number {
    const kit = EXPLORE_RULES.terrains.find((t) => t.terrain === terrain);
    if (!kit) throw new Error(terrain);
    const kitWeight = kit.kinds.reduce((sum, k) => sum + k.weight, 0);
    return kit.kinds.reduce((sum, k) => {
      const table = exploreFindTable(EXPLORE_FINDS, k.kind, terrain);
      if (!table) throw new Error(k.kind);
      const tableWeight = table.finds.reduce((s, f) => s + f.weight, 0);
      const glimmer = table.finds.reduce((s, f) => s + f.weight * (f.items?.['glimmer'] ?? 0), 0);
      return sum + (k.weight / kitWeight) * (glimmer / tableWeight);
    }, 0);
  }

  it('turns up from every mountain and hills spot but the hills rock, and stays a treat', () => {
    for (const terrain of ['mountains', 'hills']) {
      const kit = EXPLORE_RULES.terrains.find((t) => t.terrain === terrain);
      for (const { kind } of kit?.kinds ?? []) {
        if (kind === 'rock') continue;
        const table = exploreFindTable(EXPLORE_FINDS, kind, terrain);
        expect(
          table?.finds.some((f) => (f.items?.['glimmer'] ?? 0) > 0),
          kind,
        ).toBe(true);
      }
    }
    // TUNE: about 1 in 10 mountain spots and 1 in 4–5 hills spots (#523).
    expect(glimmerPerSpot('mountains')).toBeCloseTo(0.099, 3);
    expect(glimmerPerSpot('hills')).toBeCloseTo(0.225, 3);
  });
});
