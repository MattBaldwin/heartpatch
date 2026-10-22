import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../communities.js';
import { EXPLORE_RULES } from '../explore.js';
import { GAME_DATA } from '../index.js';
import { LORE_PAGES } from './lore-pages.js';
import { checkExploreFinds } from '../../schemas/data/explore-finds.js';
import type { ExploreFindTable } from '../../schemas/data/explore-finds.js';
import { EXPLORE_FINDS } from './explore-finds.js';
import { CELLAR_RULES } from './cellar.js';
import { CELLAR_FINDS, cellarFinds, HOLLOWED_FINDS, hollowedFinds } from './hollowed-finds.js';

const share = (table: ExploreFindTable, joy = 'heartdust') => {
  const t = table.finds.reduce((a, f) => a + f.weight, 0);
  const h = table.finds.filter((f) => (f.items?.[joy] ?? 0) > 0).reduce((a, f) => a + f.weight, 0);
  return h / t;
};

describe('the Hollowed find tables (#306 2a)', () => {
  it('find the joy exactly heartdustFindMultiplier times as often, in whole weights', () => {
    const m = COMMUNITY_RULES.heartdustFindMultiplier;
    EXPLORE_FINDS.forEach((table, i) => {
      const hollowed = HOLLOWED_FINDS[i]!;
      expect(hollowed.kind).toBe(table.kind);
      expect(share(hollowed)).toBeCloseTo(Math.min(1, share(table) * m), 10);
      for (const f of hollowed.finds) expect(Number.isInteger(f.weight)).toBe(true);
    });
  });

  it('are still valid find tables', () => {
    const pages = LORE_PAGES.map((p) => p.id);
    expect(checkExploreFinds(HOLLOWED_FINDS, GAME_DATA, EXPLORE_RULES, pages)).toEqual([]);
  });

  it('keep a table without the joy as it is, and only the joy where it would pass every find', () => {
    const tables: ExploreFindTable[] = [
      { kind: 'rock', finds: [{ weight: 3, items: { stone: 1 } }, { weight: 1 }] },
      {
        kind: 'tree',
        finds: [
          { weight: 1, items: { heartdust: 1 } },
          { weight: 1, items: { timber: 1 } },
        ],
      },
    ];
    const [rock, tree] = hollowedFinds(tables, 3, 'heartdust');
    expect(rock).toEqual(tables[0]);
    expect(tree!.finds).toEqual([{ weight: 1, items: { heartdust: 1 } }]);
  });
});

describe('the hidden cellar find tables (#306 PR 2c)', () => {
  const rare = (table: ExploreFindTable) => {
    const t = table.finds.reduce((a, f) => a + f.weight, 0);
    const h = table.finds
      .filter((f) => (f.items?.['heartdust'] ?? 0) > 0 || f.lore !== undefined)
      .reduce((a, f) => a + f.weight, 0);
    return h / t;
  };
  const full = (table: ExploreFindTable): ExploreFindTable => ({
    ...table,
    finds: table.finds.filter((f) => f.items || f.lore),
  });

  it('never find nothing, and find rare things rareFindMultiplier times as often', () => {
    const m = CELLAR_RULES.rareFindMultiplier;
    HOLLOWED_FINDS.forEach((table, i) => {
      const cellar = CELLAR_FINDS[i]!;
      expect(cellar.kind).toBe(table.kind);
      for (const f of cellar.finds) {
        expect(f.items !== undefined || f.lore !== undefined).toBe(true);
        expect(Number.isInteger(f.weight)).toBe(true);
      }
      expect(rare(cellar)).toBeCloseTo(Math.min(1, rare(full(table)) * m), 10);
    });
  });

  it('are better than a grey tile for every kit spot the cellar has', () => {
    for (const { kind } of COMMUNITY_RULES.cellar.kinds) {
      const i = HOLLOWED_FINDS.findIndex((t) => t.kind === kind && !t.terrains);
      expect(rare(CELLAR_FINDS[i]!)).toBeGreaterThan(rare(HOLLOWED_FINDS[i]!));
    }
  });

  it('are still valid find tables', () => {
    const pages = LORE_PAGES.map((p) => p.id);
    expect(checkExploreFinds(CELLAR_FINDS, GAME_DATA, EXPLORE_RULES, pages)).toEqual([]);
  });

  it('keep a table that only finds nothing', () => {
    const tables: ExploreFindTable[] = [{ kind: 'rock', finds: [{ weight: 2 }] }];
    expect(cellarFinds(tables, 2, 'heartdust')).toEqual(tables);
  });
});
