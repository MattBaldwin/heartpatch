import { describe, expect, it } from 'vitest';
import { checkClothingDrops, type ClothingDropTable } from '../../schemas/data/clothing-drops.js';
import { CLOTHING } from '../clothing.js';
import { GAME_DATA } from '../index.js';
import { CLOTHING_DROPS } from './clothing-drops.js';

const TERRAINS = GAME_DATA.terrains.map((t) => t.id);
const copy = (): ClothingDropTable[] => structuredClone(CLOTHING_DROPS);

describe('clothing drop tables (server-only)', () => {
  it('pass their checks: every found item can drop, from gathers, captures, rescues, wild wins and explore finds', () => {
    expect(checkClothingDrops(CLOTHING_DROPS, CLOTHING, TERRAINS)).toEqual([]);
    expect(CLOTHING_DROPS.map((t) => t.source).toSorted()).toEqual([
      'battle',
      'capture',
      'explore',
      'gather',
      'rescue',
    ]);
  });

  it('can find every #261 costume from gathers, captures, wild wins and explore finds', () => {
    const costumes = CLOTHING.filter((i) => i.slot === 'costume' && i.season === 'halloween');
    for (const source of ['gather', 'capture', 'battle', 'explore'] as const) {
      const table = CLOTHING_DROPS.find((t) => t.source === source)!;
      for (const id of [
        'hollow-man-costume',
        'marigold-calavera',
        'zippy-hedgehog',
        'glow-moth',
        'moonbroom-witch',
        'bat-buddy',
        'star-striker',
        'cozy-mummy',
        'patch-scarecrow',
        'candy-corn-cutie',
      ]) {
        expect(costumes.some((c) => c.id === id)).toBe(true);
        expect(
          table.entries.some((e) => e.item === id),
          `${source} ${id}`,
        ).toBe(true);
      }
    }
  });

  it('makes rarer costumes much rarer, the Mythic rarest of all', () => {
    for (const table of CLOTHING_DROPS) {
      const weight = (id: string) => table.entries.find((e) => e.item === id)?.weight;
      if (weight('hollow-man-costume') === undefined) continue;
      const ladder = [
        'patch-scarecrow',
        'star-striker',
        'moonbroom-witch',
        'zippy-hedgehog',
        'marigold-calavera',
        'hollow-man-costume',
      ].map((id) => weight(id) ?? 0);
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]!);
      expect(Math.min(...table.entries.map((e) => e.weight))).toBe(weight('hollow-man-costume'));
    }
  });

  it('finds more when the land is taken from a rival, and only captures take land', () => {
    const capture = CLOTHING_DROPS.find((t) => t.source === 'capture')!;
    expect(capture.rivalChance).toBeGreaterThan(capture.chance);
    const tables = copy();
    tables.find((t) => t.source === 'gather')!.rivalChance = 50;
    expect(checkClothingDrops(tables, CLOTHING, TERRAINS)).toEqual([
      'drops[0].rivalChance: only captures take land from a rival',
    ]);
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
    expect(problems).toContain('drops[0].entries[42].item: unknown clothing "crown-of-doom"');
    expect(problems).toContain('drops[0].entries[43].item: "sunny-cap" isn\'t a found item');
    expect(problems).toContain('drops[0].entries[44].item: "heart-clip" is listed twice');
    expect(problems).toContain('drops[0].entries[44].terrains[0]: unknown terrain "moon"');
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
