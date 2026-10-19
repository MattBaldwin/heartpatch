import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../communities.js';
import { EXPLORE_RULES } from '../explore.js';
import { GAME_DATA } from '../index.js';
import { LORE_PAGES } from './lore-pages.js';
import { checkExploreFinds } from '../../schemas/data/explore-finds.js';
import type { ExploreFindTable } from '../../schemas/data/explore-finds.js';
import { EXPLORE_FINDS } from './explore-finds.js';
import { HOLLOWED_FINDS, hollowedFinds } from './hollowed-finds.js';

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
