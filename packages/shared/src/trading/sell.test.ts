import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { HEART_COIN_RULES } from '../data/heart-coins.js';
import { GLIMMER_SWAP, SELL_RULES } from '../data/trading.js';
import { recipeBookPages, recipePageKey } from '../recipe-book/index.js';
import { checkSellRules } from '../schemas/data/trading.js';
import {
  clothingSalePrice,
  itemSalePrice,
  itemSaleQuantity,
  recipeKeep,
  sellableLots,
  spareCopies,
} from './sell.js';

const CAP = HEART_COIN_RULES.dailyCaps.sell;

describe('SELL_RULES (#601 PR 3)', () => {
  it('passes its checks', () => {
    expect(checkSellRules(SELL_RULES, GAME_DATA.resources, CAP)).toEqual([]);
  });

  it('never buys a tool, an unknown or never-sold item, or a lot past the cap', () => {
    const broken = {
      items: {
        shovel: { lot: 1, coins: 1 },
        gold: { lot: 1, coins: 1 },
        heartdust: { lot: 1, coins: 1 },
        timber: { lot: 5, coins: CAP + 1 },
      },
      clothing: { ...SELL_RULES.clothing, mythic: CAP + 1 },
      neverSold: ['heartdust', 'moonbeams'],
    };
    expect(checkSellRules(broken, GAME_DATA.resources, CAP)).toEqual([
      'items: "shovel" stays with its Keeper',
      'items: unknown item "gold"',
      'items: "heartdust" is never sold',
      'items: one lot of "timber" is more than a day\'s cap',
      'neverSold: unknown item "moonbeams"',
      "clothing: a mythic piece is more than a day's cap",
    ]);
  });

  it('prices every clothing rarity', () => {
    expect(checkSellRules({ ...SELL_RULES, clothing: { common: 1 } }, [], CAP)).not.toEqual([]);
  });

  it('makes the Glimmer swap no coin farm: swapping, then selling the Glimmer, pays no more', () => {
    const glimmer = itemSalePrice(SELL_RULES, 'glimmer', GLIMMER_SWAP.get)!;
    for (const id of GLIMMER_SWAP.accepts) {
      const { lot } = SELL_RULES.items[id]!;
      const direct = itemSalePrice(SELL_RULES, id, Math.floor(GLIMMER_SWAP.give / lot))!;
      expect(glimmer, id).toBeLessThanOrEqual(direct);
    }
  });
});

describe('selling maths', () => {
  it('prices and counts lots from the data', () => {
    expect(itemSalePrice(SELL_RULES, 'timber', 3)).toBe(3 * SELL_RULES.items['timber']!.coins);
    expect(itemSaleQuantity(SELL_RULES, 'timber', 3)).toBe(3 * SELL_RULES.items['timber']!.lot);
    expect(itemSalePrice(SELL_RULES, 'shovel', 1)).toBeNull();
    expect(itemSaleQuantity(SELL_RULES, 'heartdust', 1)).toBeNull();
    expect(clothingSalePrice(SELL_RULES, 'rare')).toBe(SELL_RULES.clothing.rare);
  });

  it("keeps the most one open recipe uses, and nothing for a sealed page's", () => {
    const pages = recipeBookPages();
    const charm = pages.find((p) => p.key === recipePageKey('heart-charm'))!;
    const timberForCharm = charm.ingredients['timber']!;
    expect(recipeKeep('timber', pages, new Set([charm.key]))).toBe(timberForCharm);
    expect(recipeKeep('timber', pages, new Set())).toBe(0);
    // Every open recipe counts; the keep is the biggest single one, not their sum.
    const open = new Set(pages.filter((p) => p.kind === 'recipe').map((p) => p.key));
    const most = Math.max(
      ...pages.filter((p) => p.kind === 'recipe').map((p) => p.ingredients['treats'] ?? 0),
    );
    expect(recipeKeep('treats', pages, open)).toBe(most);
    // Building pages don't hold anything back.
    const buildings = new Set(pages.filter((p) => p.kind === 'building').map((p) => p.key));
    expect(recipeKeep('stone', pages, buildings)).toBe(0);
  });

  it('sells whole lots above the keep, and never the last clothing copy', () => {
    expect(sellableLots(12, 2, 5)).toBe(2);
    expect(sellableLots(6, 2, 5)).toBe(0);
    expect(sellableLots(1, 2, 5)).toBe(0);
    expect(spareCopies(1)).toBe(0);
    expect(spareCopies(3)).toBe(2);
    expect(spareCopies(0)).toBe(0);
  });
});
