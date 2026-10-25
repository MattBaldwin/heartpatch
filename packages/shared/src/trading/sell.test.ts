import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { HEART_COIN_RULES } from '../data/heart-coins.js';
import { GLIMMER_SWAP, SELL_RULES } from '../data/trading.js';
import { recipeBookPages, recipePageKey } from '../recipe-book/index.js';
import type { ClothingRarity } from '../schemas/data/clothing.js';
import type { SellRules } from '../schemas/data/trading.js';
import { checkSellRules } from '../schemas/data/trading.js';
import {
  AnySellRequestSchema,
  SellBasketRequestSchema,
  SellRequestSchema,
  type SellLine,
  type SellView,
} from '../schemas/trading.js';
import {
  basketProblem,
  basketTotal,
  clothingSalePrice,
  itemSalePrice,
  itemSaleQuantity,
  planSpareClothing,
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

  it('buys Pies for a bit more than the Flour, Fish and Salt a bake uses (#621 W1-8b)', () => {
    expect(SELL_RULES.items['pies']).toEqual({ lot: 1, coins: 1 });
    const bake = GAME_DATA.recipes.find((r) => r.id === 'bake-pies')!;
    const inputs = Object.entries(bake.inputs).reduce((sum, [id, n]) => {
      const { lot, coins } = SELL_RULES.items[id]!;
      return sum + (coins * n) / lot;
    }, 0);
    const pies = itemSalePrice(SELL_RULES, 'pies', bake.output.quantity)!;
    expect(pies).toBeGreaterThan(inputs);
    // …but never a coin farm: a bake is still well under a day's cap.
    expect(pies).toBeLessThan(CAP);
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

// A basket (#655), against prices picked for easy sums.
const RULES: SellRules = {
  items: { timber: { lot: 5, coins: 1 }, stone: { lot: 5, coins: 2 } },
  clothing: { common: 1, uncommon: 2, rare: 2, epic: 5, legendary: 8, mythic: 13 },
  neverSold: ['heartdust'],
};
const RARITY: Record<string, ClothingRarity> = {
  'bat-bow': 'rare',
  'cozy-scarf': 'common',
  'ghost-cape': 'legendary',
  'heart-mittens': 'rare',
  'pumpkin-hood': 'uncommon',
};
const rarityOf = (itemId: string) => RARITY[itemId];

const viewOf = (soldToday: number, clothing: SellView['clothing']): SellView => ({
  balance: 40,
  soldToday,
  cap: 150,
  resetsAt: '2026-10-25T07:00:00.000Z',
  items: [
    { itemId: 'timber', have: 23, keep: 5 },
    { itemId: 'stone', have: 10, keep: 0 },
  ],
  clothing,
});

const SPARES: SellView['clothing'] = [
  { itemId: 'cozy-scarf', copies: 3 },
  { itemId: 'ghost-cape', copies: 2 },
  { itemId: 'heart-mittens', copies: 5 },
  { itemId: 'pumpkin-hood', copies: 4 },
];

describe('selling a basket (#655)', () => {
  it('basketTotal prices every line and returns null for an unbought one', () => {
    const lines: SellLine[] = [
      { kind: 'item', itemId: 'timber', lots: 3 },
      { kind: 'clothing', itemId: 'ghost-cape', count: 1 },
      { kind: 'clothing', itemId: 'pumpkin-hood', count: 3 },
    ];
    // Items and pieces, not lines: 15 Timber + 1 + 3.
    expect(basketTotal(RULES, rarityOf, lines)).toEqual({ quantity: 19, coins: 3 + 8 + 6 });
    expect(basketTotal(RULES, rarityOf, [])).toEqual({ quantity: 0, coins: 0 });
    for (const bad of [
      { kind: 'item', itemId: 'shovel', lots: 1 },
      { kind: 'item', itemId: 'heartdust', lots: 1 },
      { kind: 'clothing', itemId: 'starter-tee', count: 1 },
    ] satisfies SellLine[]) {
      expect(basketTotal(RULES, rarityOf, [...lines, bad]), bad.itemId).toBeNull();
    }
  });

  it('planSpareClothing keeps one of each, prefers rarer pieces, trims to the room, and is deterministic', () => {
    // Plenty of room: every spare, one copy of each stays, in row order.
    expect(planSpareClothing(viewOf(0, SPARES), RULES, rarityOf)).toEqual([
      { kind: 'clothing', itemId: 'cozy-scarf', count: 2 },
      { kind: 'clothing', itemId: 'ghost-cape', count: 1 },
      { kind: 'clothing', itemId: 'heart-mittens', count: 4 },
      { kind: 'clothing', itemId: 'pumpkin-hood', count: 3 },
    ]);
    // 15 💛 of room: the cape (8), then 3 of 4 mittens (6); no hood fits in
    // the last 1, so it's skipped and a scarf takes it. 15 💛, rarer first.
    const view = viewOf(135, SPARES);
    const plan = planSpareClothing(view, RULES, rarityOf);
    expect(plan).toEqual([
      { kind: 'clothing', itemId: 'cozy-scarf', count: 1 },
      { kind: 'clothing', itemId: 'ghost-cape', count: 1 },
      { kind: 'clothing', itemId: 'heart-mittens', count: 3 },
    ]);
    expect(basketTotal(RULES, rarityOf, plan)).toEqual({ quantity: 5, coins: 15 });
    expect(basketProblem(view, RULES, rarityOf, plan)).toBeNull();
    // Same view, same plan, whatever the call.
    expect(planSpareClothing(structuredClone(view), RULES, rarityOf)).toEqual(plan);
    // Rarer beats row order; ties in rarity go in row order.
    const room4 = (ids: string[]) =>
      planSpareClothing(
        viewOf(
          146,
          ids.map((itemId) => ({ itemId, copies: 3 })),
        ),
        RULES,
        rarityOf,
      );
    expect(room4(['pumpkin-hood', 'heart-mittens'])).toEqual([
      { kind: 'clothing', itemId: 'heart-mittens', count: 2 },
    ]);
    expect(room4(['bat-bow', 'heart-mittens'])).toEqual([
      { kind: 'clothing', itemId: 'bat-bow', count: 2 },
    ]);
    expect(room4(['heart-mittens', 'bat-bow'])).toEqual([
      { kind: 'clothing', itemId: 'heart-mittens', count: 2 },
    ]);
  });

  it('planSpareClothing never plans a piece the post does not buy, nor past 50 of one', () => {
    const view = viewOf(0, [
      { itemId: 'starter-tee', copies: 9 },
      { itemId: 'cozy-scarf', copies: 80 },
    ]);
    expect(planSpareClothing(view, RULES, rarityOf)).toEqual([
      { kind: 'clothing', itemId: 'cozy-scarf', count: 50 },
    ]);
  });

  it('planSpareClothing is empty when room is 0 or there are no spares', () => {
    expect(planSpareClothing(viewOf(150, SPARES), RULES, rarityOf)).toEqual([]);
    expect(planSpareClothing(viewOf(0, []), RULES, rarityOf)).toEqual([]);
  });

  it('basketProblem flags duplicates, keep, last copy and the cap', () => {
    const view = viewOf(0, SPARES);
    const ok: SellLine[] = [
      { kind: 'item', itemId: 'timber', lots: 3 },
      { kind: 'clothing', itemId: 'heart-mittens', count: 4 },
    ];
    expect(basketProblem(view, RULES, rarityOf, ok)).toBeNull();
    expect(
      basketProblem(view, RULES, rarityOf, [...ok, { kind: 'item', itemId: 'timber', lots: 1 }]),
    ).toBe('dup');
    expect(
      basketProblem(view, RULES, rarityOf, [{ kind: 'item', itemId: 'shovel', lots: 1 }]),
    ).toBe('notBought');
    // 23 Timber keeping 5 is 3 lots; 4 would dip below the keep.
    expect(
      basketProblem(view, RULES, rarityOf, [{ kind: 'item', itemId: 'timber', lots: 4 }]),
    ).toBe('keep');
    // Priced, but not in my bag.
    const noStone = { ...view, items: view.items.slice(0, 1) };
    expect(
      basketProblem(noStone, RULES, rarityOf, [{ kind: 'item', itemId: 'stone', lots: 1 }]),
    ).toBe('keep');
    expect(
      basketProblem(view, RULES, rarityOf, [
        { kind: 'clothing', itemId: 'heart-mittens', count: 5 },
      ]),
    ).toBe('lastCopy');
    const oneCopy = viewOf(0, []);
    expect(
      basketProblem(oneCopy, RULES, rarityOf, [
        { kind: 'clothing', itemId: 'ghost-cape', count: 1 },
      ]),
    ).toBe('lastCopy');
    // 3 + 8 = 11 💛 against 10 of room.
    expect(
      basketProblem(viewOf(140, SPARES), RULES, rarityOf, [
        { kind: 'item', itemId: 'timber', lots: 3 },
        { kind: 'clothing', itemId: 'ghost-cape', count: 1 },
      ]),
    ).toBe('capped');
  });

  it('SellBasketRequest refuses 0 lines, 41 lines, a repeated line and lots 0 / 101', () => {
    const at = { kind: 'basket', q: 2, r: -1 } as const;
    const line = (i: number) => ({ kind: 'item', itemId: `item-${String(i)}`, lots: 1 });
    expect(SellBasketRequestSchema.safeParse({ ...at, lines: [line(0)] }).success).toBe(true);
    expect(
      SellBasketRequestSchema.safeParse({
        ...at,
        lines: Array.from({ length: 40 }, (_, i) => line(i)),
      }).success,
    ).toBe(true);
    for (const lines of [
      [],
      Array.from({ length: 41 }, (_, i) => line(i)),
      [line(0), line(0)],
      [{ kind: 'item', itemId: 'timber', lots: 0 }],
      [{ kind: 'item', itemId: 'timber', lots: 101 }],
      [{ kind: 'clothing', itemId: 'ghost-cape', count: 0 }],
      [{ kind: 'clothing', itemId: 'ghost-cape', count: 51 }],
      [{ kind: 'clothing', itemId: 'ghost-cape', lots: 1 }],
    ]) {
      expect(
        SellBasketRequestSchema.safeParse({ ...at, lines }).success,
        JSON.stringify(lines),
      ).toBe(false);
    }
    // The same item as an item line and a clothing line is two lines.
    expect(
      SellBasketRequestSchema.safeParse({
        ...at,
        lines: [line(0), { kind: 'clothing', itemId: 'item-0', count: 1 }],
      }).success,
    ).toBe(true);
  });

  it('the sell route still takes the one-line request alongside the basket', () => {
    const legacy = { kind: 'clothing', q: 0, r: 0, itemId: 'ghost-cape' };
    expect(SellRequestSchema.parse(legacy)).toEqual(legacy);
    expect(AnySellRequestSchema.parse(legacy)).toEqual(legacy);
    const basket = {
      kind: 'basket',
      q: 0,
      r: 0,
      lines: [{ kind: 'item', itemId: 'timber', lots: 2 }],
    };
    expect(AnySellRequestSchema.parse(basket)).toEqual(basket);
    expect(SellRequestSchema.safeParse(basket).success).toBe(false);
  });
});
