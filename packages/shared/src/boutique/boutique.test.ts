import { describe, expect, it } from 'vitest';
import { CLOTHING, CLOTHING_BY_ID } from '../data/clothing.js';
import { BOUTIQUE_RULES, COIN_RULES } from '../data/coins.js';
import { checkBoutiqueData, checkCoinRules } from '../schemas/data/coins.js';
import type { ClothingItem } from '../schemas/data/clothing.js';
import { boutiqueStock, inStock } from './index.js';

const SEED = 'player-1';
const OCTOBER = { seed: SEED, date: '2026-10-15', seasons: ['halloween'] };
const all = (stock: ReturnType<typeof boutiqueStock>) => [
  ...stock.daily,
  ...stock.seasonal.flatMap((r) => r.items),
];

describe('boutique data', () => {
  it('has coin rules, rack sizes and prices that pass their checks', () => {
    expect(checkCoinRules(COIN_RULES)).toEqual([]);
    expect(checkBoutiqueData(BOUTIQUE_RULES, CLOTHING)).toEqual([]);
  });

  it('prices only clothing the Boutique sells, and keeps legendaries found-only', () => {
    for (const item of CLOTHING) {
      expect(item.boutiquePrice !== undefined, item.id).toBe(item.sources.includes('boutique'));
      if (item.rarity === 'legendary') expect(item.boutiquePrice, item.id).toBeUndefined();
    }
    // Every Halloween rack has something to sell.
    expect(CLOTHING.some((i) => i.season === 'halloween' && i.boutiquePrice)).toBe(true);
  });

  it('flags prices out of range, a rarer piece that costs less, and too few to fill a rack', () => {
    const cheapRare: ClothingItem = { ...CLOTHING_BY_ID.get('starry-crown')!, boutiquePrice: 6 };
    const problems = checkBoutiqueData({ ...BOUTIQUE_RULES, maxPrice: 50 }, [
      ...CLOTHING.filter((i) => i.id !== 'starry-crown'),
      cheapRare,
    ]).join('\n');
    expect(problems).toMatch(/butterfly-wings: boutiquePrice 100 is outside 5–50/);
    expect(problems).toMatch(/starry-crown: a rare piece costs less than/);
    expect(checkBoutiqueData({ ...BOUTIQUE_RULES, dailySlots: 12 }, CLOTHING.slice(0, 20))).toEqual(
      [expect.stringMatching(/can't fill 12 daily slots/)],
    );
    expect(
      checkBoutiqueData({ ...BOUTIQUE_RULES, minPrice: 10, maxPrice: 5 }, CLOTHING),
    ).not.toEqual([]);
  });
});

describe('boutiqueStock', () => {
  it('is the same for the same seed and day', () => {
    expect(boutiqueStock(CLOTHING, OCTOBER, BOUTIQUE_RULES)).toEqual(
      boutiqueStock(CLOTHING, { ...OCTOBER }, BOUTIQUE_RULES),
    );
  });

  it('fills each rack with priced pieces, no repeats, in catalog order', () => {
    const stock = boutiqueStock(CLOTHING, OCTOBER, BOUTIQUE_RULES);
    expect(stock.daily).toHaveLength(BOUTIQUE_RULES.dailySlots);
    expect(stock.seasonal).toHaveLength(1);
    expect(stock.seasonal[0]!.items).toHaveLength(BOUTIQUE_RULES.seasonalSlots);
    const order = (id: string) => CLOTHING.findIndex((i) => i.id === id);
    for (const rack of [stock.daily, stock.seasonal[0]!.items]) {
      expect(new Set(rack).size).toBe(rack.length);
      expect(rack.map(order)).toEqual([...rack.map(order)].sort((a, b) => a - b));
    }
    for (const id of stock.daily) expect(CLOTHING_BY_ID.get(id)!.season).toBeUndefined();
    for (const id of all(stock)) expect(CLOTHING_BY_ID.get(id)!.boutiquePrice).toBeDefined();
  });

  it('changes from day to day and shop to shop, and every piece turns up', () => {
    const racks = new Set<string>();
    const seen = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      const stock = boutiqueStock(CLOTHING, { ...OCTOBER, date }, BOUTIQUE_RULES);
      racks.add(stock.daily.join());
      for (const id of all(stock)) seen.add(id);
    }
    expect(racks.size).toBeGreaterThan(25);
    expect([...seen].sort()).toEqual(
      CLOTHING.filter((i) => i.boutiquePrice !== undefined)
        .map((i) => i.id)
        .sort(),
    );
    const shops = new Set(
      ['a', 'b', 'c', 'd'].map((seed) =>
        boutiqueStock(CLOTHING, { ...OCTOBER, seed }, BOUTIQUE_RULES).daily.join(),
      ),
    );
    expect(shops.size).toBeGreaterThan(1);
  });

  it('sells seasonal pieces only in their season, and keeps today’s rack when a season starts', () => {
    const outOfSeason = boutiqueStock(CLOTHING, { ...OCTOBER, seasons: [] }, BOUTIQUE_RULES);
    expect(outOfSeason.seasonal).toEqual([]);
    expect(all(outOfSeason).some((id) => CLOTHING_BY_ID.get(id)!.season)).toBe(false);
    // A season with nothing to sell gets no rack.
    expect(
      boutiqueStock(CLOTHING, { ...OCTOBER, seasons: ['thanksgiving'] }, BOUTIQUE_RULES).seasonal,
    ).toEqual([]);
    // Each rack rolls on its own, so a season's rack never reshuffles the daily one.
    expect(outOfSeason.daily).toEqual(boutiqueStock(CLOTHING, OCTOBER, BOUTIQUE_RULES).daily);
  });

  it('sells everything when a rack has more slots than pieces', () => {
    const few = CLOTHING.filter((i) => i.season === 'halloween' && i.boutiquePrice).slice(0, 2);
    const stock = boutiqueStock(few, OCTOBER, { dailySlots: 6, seasonalSlots: 4 });
    expect(stock).toEqual({
      daily: [],
      seasonal: [{ seasonId: 'halloween', items: few.map((i) => i.id) }],
    });
  });

  it('knows what is in stock', () => {
    const stock = boutiqueStock(CLOTHING, OCTOBER, BOUTIQUE_RULES);
    expect(inStock(stock, stock.daily[0]!)).toBe(true);
    expect(inStock(stock, stock.seasonal[0]!.items[0]!)).toBe(true);
    expect(inStock(stock, 'sunny-cap')).toBe(false);
  });
});
