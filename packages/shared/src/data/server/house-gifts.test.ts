import { describe, expect, it } from 'vitest';
import { checkHouseGifts, type HouseGiftRefs } from '../../schemas/data/house-gifts.js';
import { HOUSE_DATA } from '../house.js';
import { GAME_DATA } from '../index.js';
import { HOUSE_GIFTS } from './house-gifts.js';

const refs: HouseGiftRefs = { resources: GAME_DATA.resources, maxLevel: HOUSE_DATA.levels.length };

describe("the house's gift table (#381 PR H, server-only)", () => {
  it('passes its checks, one gift a day', () => {
    expect(checkHouseGifts(HOUSE_GIFTS, refs)).toEqual([]);
    expect(HOUSE_GIFTS.perDay).toBe(1);
  });

  it('refuses a row out of order, past the top level, or naming an unknown resource', () => {
    const broken = structuredClone(HOUSE_GIFTS);
    const [first, second] = broken.table;
    if (!first || !second) throw new Error('fixture');
    first.fromLevel = 2;
    second.fromLevel = 9;
    second.gifts.push({ itemId: 'moonbeams', min: 3, max: 1, weight: 1 });
    expect(checkHouseGifts(broken, refs)).toEqual([
      'table[0]: the first row starts at level 1',
      'table[1]: no level 9',
      'table[1].gifts[5]: unknown resource "moonbeams"',
      'table[1].gifts[5]: min is more than max',
      'table[2]: fromLevel should climb (3)',
    ]);
  });

  it('refuses more than one gift a day', () => {
    expect(checkHouseGifts({ ...HOUSE_GIFTS, perDay: 2 }, refs)).not.toEqual([]);
  });
});
