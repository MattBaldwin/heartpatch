import { describe, expect, it } from 'vitest';
import { checkClothingDrops, type ClothingDropTable } from '../../schemas/data/clothing-drops.js';
import { CLOTHING } from '../clothing.js';
import { GAME_DATA } from '../index.js';
import { CLOTHING_DROPS } from './clothing-drops.js';

const TERRAINS = GAME_DATA.terrains.map((t) => t.id);
const copy = (): ClothingDropTable[] => structuredClone(CLOTHING_DROPS);

describe('clothing drop tables (server-only)', () => {
  it('pass their checks: every found item can drop, from gathers, captures and rescues', () => {
    expect(checkClothingDrops(CLOTHING_DROPS, CLOTHING, TERRAINS)).toEqual([]);
    expect(CLOTHING_DROPS.map((t) => t.source).toSorted()).toEqual(['capture', 'gather', 'rescue']);
  });

  it('keep finds rare: a small chance per event', () => {
    for (const table of CLOTHING_DROPS) expect(table.chance).toBeLessThanOrEqual(25);
  });

  it('report unknown, unfindable and repeated items, unknown terrains and found items with no table', () => {
    const tables = copy();
    tables[0]!.entries.push(
      { item: 'crown-of-doom', weight: 1 },
      { item: 'sunny-cap', weight: 1 },
      { item: 'heart-clip', weight: 1, terrains: ['moon'] },
    );
    tables[1]!.source = 'gather';
    const problems = checkClothingDrops(tables.slice(0, 2), CLOTHING, TERRAINS);
    expect(problems).toContain('drops[0].entries[32].item: unknown clothing "crown-of-doom"');
    expect(problems).toContain('drops[0].entries[33].item: "sunny-cap" isn\'t a found item');
    expect(problems).toContain('drops[0].entries[34].item: "heart-clip" is listed twice');
    expect(problems).toContain('drops[0].entries[34].terrains[0]: unknown terrain "moon"');
    expect(problems).toContain('drops[1].source: one table per source');
    // Tables can't lose an item without it becoming impossible to find.
    const withoutHat = copy().map((t) => ({
      ...t,
      entries: t.entries.filter((e) => e.item !== 'witch-hat'),
    }));
    expect(checkClothingDrops(withoutHat, CLOTHING, TERRAINS)).toEqual([
      'drops: found item "witch-hat" is in no drop table',
    ]);
  });
});
