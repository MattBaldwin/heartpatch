import { describe, expect, it } from 'vitest';
import { CLOTHING_BY_ID } from '../data/clothing.js';
import { Rng } from '../rng/index.js';
import type { ClothingDropTable } from '../schemas/data/clothing-drops.js';
import { eligibleDrops, pickClothingDrop } from './index.js';

const TABLE: ClothingDropTable = {
  source: 'gather',
  chance: 100,
  entries: [
    { item: 'heart-clip', weight: 1 },
    { item: 'witch-hat', weight: 1 },
    { item: 'pumpkin-hood', weight: 1, terrains: ['pumpkin-fields'] },
  ],
};

const ids = (entries: readonly { item: string }[]) => entries.map((e) => e.item);

describe('eligibleDrops', () => {
  it('drops Halloween items only while Halloween is on', () => {
    expect(ids(eligibleDrops(TABLE, { seasons: new Set() }, CLOTHING_BY_ID))).toEqual([
      'heart-clip',
    ]);
    const halloween = { seasons: new Set(['halloween']), terrain: 'meadow' };
    expect(ids(eligibleDrops(TABLE, halloween, CLOTHING_BY_ID))).toEqual([
      'heart-clip',
      'witch-hat',
    ]);
  });

  it('drops terrain-bound items only on their terrain', () => {
    const fields = { seasons: new Set(['halloween']), terrain: 'pumpkin-fields' };
    expect(ids(eligibleDrops(TABLE, fields, CLOTHING_BY_ID))).toEqual([
      'heart-clip',
      'witch-hat',
      'pumpkin-hood',
    ]);
  });
});

describe('pickClothingDrop', () => {
  it('is seeded: the same seed always finds the same thing', () => {
    const context = { seasons: new Set(['halloween']), terrain: 'pumpkin-fields' };
    const roll = (seed: string) =>
      pickClothingDrop(TABLE, context, CLOTHING_BY_ID, Rng.fromSeed(seed));
    expect(roll('a')).toBe(roll('a'));
    const found = new Set(Array.from({ length: 60 }, (_, i) => roll(`s${String(i)}`)));
    expect([...found].toSorted()).toEqual(['heart-clip', 'pumpkin-hood', 'witch-hat']);
  });

  it('finds nothing at 0%, and nothing when nothing can drop here', () => {
    const rng = Rng.fromSeed('x');
    const context = { seasons: new Set<string>() };
    expect(pickClothingDrop({ ...TABLE, chance: 0 }, context, CLOTHING_BY_ID, rng)).toBeNull();
    const halloweenOnly = { ...TABLE, entries: [{ item: 'witch-hat', weight: 1 }] };
    expect(pickClothingDrop(halloweenOnly, context, CLOTHING_BY_ID, rng)).toBeNull();
  });

  it('finds something about as often as the chance says', () => {
    const rng = Rng.fromSeed('odds');
    const context = { seasons: new Set<string>() };
    let found = 0;
    for (let i = 0; i < 2000; i++) {
      if (pickClothingDrop({ ...TABLE, chance: 10 }, context, CLOTHING_BY_ID, rng)) found++;
    }
    expect(found).toBeGreaterThan(140);
    expect(found).toBeLessThan(260);
  });
});
