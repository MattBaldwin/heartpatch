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
        'finds[12]: unknown spot kind "puddle"',
        'finds[13]: unknown terrain "moon"',
        'finds[13].finds[0]: unknown item "gold"',
        'finds[14].finds[0]: "pumpkins" can\'t be found exploring',
        'finds[15].finds[0]: "shovel" can\'t be found exploring',
        'finds[16].finds[0]: unknown lore page "no-such-page"',
        'spot kind "cave" has no find table',
      ]),
    );
  });

  it('refuse a find that is items and a page at once', () => {
    const both = [{ kind: 'rock', finds: [{ weight: 1, items: { stone: 1 }, lore: 'x' }] }];
    expect(checkExploreFinds(both, GAME_DATA, EXPLORE_RULES, pages)).not.toEqual([]);
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
