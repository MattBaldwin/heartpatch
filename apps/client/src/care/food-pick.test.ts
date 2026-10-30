import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  bestFood,
  bigFeed,
  FOOD_TEXT,
  foodCount,
  foodHint,
  foodRow,
  shortFoodName,
} from './food-pick.js';

const hailhop = { name: 'Hailhop', element: 'frost' } as const;
const puddlepuff = { name: 'Puddlepuff', element: 'water' } as const;

describe('the food row (option C, 2026-10-30)', () => {
  it('is not there with only Treats, or no food at all', () => {
    expect(foodRow({ treats: 12 }, hailhop, null)).toBeNull();
    expect(foodRow({}, hailhop, null)).toBeNull();
    expect(foodRow({ timber: 4 }, hailhop, null)).toBeNull();
  });

  it('shows every food in the bag, the best pre-picked and tagged', () => {
    const row = foodRow({ treats: 12, pies: 3, 'frosty-treats': 2, timber: 9 }, puddlepuff, null);
    expect(row?.tiles.map((t) => [t.id, t.short, t.count, t.percent, t.best, t.picked])).toEqual([
      ['treats', 'Treats', 12, 100, false, false],
      ['pies', 'Pies', 3, 150, true, true],
      ['frosty-treats', 'Frosty', 2, 100, false, false],
    ]);
    expect(row?.picked).toBe('pies');
    expect(row?.hint).toBe('Puddlepuff loves Pies!');
  });

  it("picks Frosty Treats for a Frost squishy, from the shared foods' numbers", () => {
    const row = foodRow({ treats: 12, 'frosty-treats': 2 }, hailhop, null);
    expect(row?.picked).toBe('frosty-treats');
    expect(row?.tiles.find((t) => t.best)?.id).toBe('frosty-treats');
    expect(row?.hint).toBe('Hailhop loves Frosty Treats!');
  });

  it('tags nothing when no food beats Treats for this squishy', () => {
    const row = foodRow({ treats: 1, 'frosty-treats': 5 }, puddlepuff, null);
    // Equal: the one there's more of.
    expect(row?.picked).toBe('frosty-treats');
    expect(row?.tiles.some((t) => t.best)).toBe(false);
    expect(row?.hint).toBe('Frosty Treats are best for Frost squishies.');
  });

  it('keeps the player’s tap, and falls back to the best once that food runs out', () => {
    const bag = { treats: 12, pies: 3, 'frosty-treats': 2 };
    expect(foodRow(bag, hailhop, 'treats')?.picked).toBe('treats');
    expect(foodRow(bag, hailhop, 'treats')?.hint).toBe('');
    expect(foodRow({ ...bag, treats: 0 }, hailhop, 'treats')?.picked).toBe('pies');
  });
});

describe('the best food', () => {
  it('is the yummiest, then the one there’s most of, then the cheapest', () => {
    // A Frost squishy: Pies and Frosty Treats are both 150.
    expect(bestFood({ treats: 9, pies: 3, 'frosty-treats': 5 }, 'frost')).toBe('frosty-treats');
    expect(bestFood({ treats: 9, pies: 5, 'frosty-treats': 3 }, 'frost')).toBe('pies');
    // Same count: the food table's order, so Pies before Frosty Treats.
    expect(bestFood({ pies: 2, 'frosty-treats': 2 }, 'frost')).toBe('pies');
    // Treats and Frosty Treats tie for anyone else: never burn the special one by default.
    expect(bestFood({ treats: 2, 'frosty-treats': 2 }, 'water')).toBe('treats');
    expect(bestFood({}, 'water')).toBeNull();
  });
});

describe('the food words', () => {
  it('fit a tile and the Feed button', () => {
    expect(shortFoodName('Frosty Treats')).toBe('Frosty');
    expect(shortFoodName('Pies')).toBe('Pies');
    expect(foodCount('pies', 3)).toBe('3 Pies');
    expect(foodCount('pies', 1)).toBe('1 Pie');
    expect(foodCount('frosty-treats', 2)).toBe('2 Frosty');
    expect(foodHint('treats', hailhop)).toBe('');
  });

  it('avoid the style guide’s words', () => {
    const words = [FOOD_TEXT.best, FOOD_TEXT.row, FOOD_TEXT.loves('Hailhop', 'Pies')];
    for (const w of words) expect(findAvoidedWords(w), w).toEqual([]);
  });
});

describe('the big "Yum!" moment', () => {
  it("comes from the server's number: more than a plain full feed", () => {
    expect(bigFeed({ action: 'feed', contentmentGained: 30 })).toBe(true);
    expect(bigFeed({ action: 'feed', contentmentGained: 20 })).toBe(false);
    // Past the day's full feeds, a Pie gives less: the usual squash.
    expect(bigFeed({ action: 'feed', contentmentGained: 15 })).toBe(false);
    expect(bigFeed({ action: 'heart-snack', contentmentGained: 40 })).toBe(false);
  });
});
