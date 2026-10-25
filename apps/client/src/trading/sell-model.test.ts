import { planSpareClothing, SELL_RULES, type SellView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { hoursToReset } from './glimmer-swap-model.js';
import {
  basketLines,
  basketTotals,
  canAdd,
  capMeter,
  clampBasket,
  confirmContent,
  countOf,
  hasSpares,
  MAX_LOTS,
  rarityOf,
  rowNote,
  SELL_TEXT,
  sellCapped,
  sellRequest,
  sellRoom,
  sellRows,
  sparesLeftOut,
  sparesPlan,
  stepLine,
  type SellBasket,
} from './sell-model.js';

// Clothing prices from SELL_RULES: common 2, uncommon 3, rare 5.
const view = (over: Partial<SellView> = {}): SellView => ({
  balance: 12,
  soldToday: 4,
  cap: 30,
  resetsAt: '2026-11-05T07:00:00.000Z',
  items: [
    { itemId: 'timber', have: 23, keep: 0 },
    { itemId: 'stone', have: 8, keep: 4 },
    { itemId: 'greens', have: 3, keep: 0 },
    { itemId: 'glimmer', have: 2, keep: 0 },
  ],
  // The server's order: by item id.
  clothing: [
    { itemId: 'cloud-cape', copies: 2 }, // rare, 1 spare
    { itemId: 'pom-pom-beanie', copies: 4 }, // common, 3 spare
    { itemId: 'rainbow-scarf', copies: 3 }, // uncommon, 2 spare
  ],
  ...over,
});

const row = (v: SellView, itemId: string) => {
  const found = sellRows(v).find((r) => r.itemId === itemId);
  if (!found) throw new Error(`no row for ${itemId}`);
  return found;
};

/** Taps a row's + (or −) `times` times. */
function tap(v: SellView, basket: SellBasket, itemId: string, times: number, delta: 1 | -1 = 1) {
  let next = basket;
  for (let i = 0; i < times; i += 1) next = stepLine(v, next, row(v, itemId), sellRows(v), delta);
  return next;
}

const empty: SellBasket = new Map();

/** A basket from empty, + tapped on each row the given times, in that order. */
const fill = (v: SellView, taps: [string, number][]) =>
  taps.reduce((b, [itemId, times]) => tap(v, b, itemId, times), empty);

describe('the Sell tab rows (#601 PR 4)', () => {
  it('lists my bag stacks in the server order, then my spare clothing in its (item id) order', () => {
    expect(sellRows(view()).map((r) => [r.kind, r.itemId])).toEqual([
      ['item', 'timber'],
      ['item', 'stone'],
      ['item', 'greens'],
      ['item', 'glimmer'],
      ['clothing', 'cloud-cape'],
      ['clothing', 'pom-pom-beanie'],
      ['clothing', 'rainbow-scarf'],
    ]);
  });

  it('prices a lot from the shared rules, and says it the short way', () => {
    const timber = row(view(), 'timber');
    expect(timber).toMatchObject({ name: 'Timber', lot: 5, coins: 1, maxLots: 4 });
    expect(SELL_TEXT.price(timber.lot, timber.coins)).toBe('5 for 1 💛');
    expect(SELL_TEXT.price(1, 2)).toBe('2 💛 each');
    expect(row(view(), 'rainbow-scarf').coins).toBe(SELL_RULES.clothing.uncommon);
  });

  it('keeps what a recipe needs, and says so', () => {
    // 8 Stone, 4 kept: one lot of 5 would leave 3.
    const stone = row(view(), 'stone');
    expect(stone).toMatchObject({ maxLots: 0, block: 'keep', need: 9 });
    expect(stone.keepLine).toBe('Keeps 4 for your recipes');
    expect(row(view(), 'timber').keepLine).toBeNull();
  });

  it('says "Need N" on a row that can\'t sell yet, "Tomorrow" when only the cap stops it', () => {
    expect(rowNote(row(view(), 'stone'), 0, false)).toBe('Need 9');
    expect(rowNote(row(view(), 'greens'), 0, false)).toBe('Need 5');
    // 1 💛 left: a Timber lot (1) fits, Glimmer (2) doesn't.
    const near = view({ soldToday: 29 });
    expect(rowNote(row(near, 'glimmer'), 0, sellCapped(near))).toBe('Tomorrow');
    expect(rowNote(row(near, 'timber'), 0, sellCapped(near))).toBe('');
    // Once nothing fits, the capped card explains.
    const full = view({ soldToday: 30 });
    expect(sellCapped(full)).toBe(true);
    expect(rowNote(row(full, 'timber'), 0, true)).toBe('');
    expect(rowNote(row(full, 'greens'), 0, true)).toBe('Need 5');
    // In the basket, the row says what it earns.
    expect(rowNote(row(view(), 'timber'), 2, false)).toBe('2 💛');
  });

  it('lets a line take up to the request limit', () => {
    const lots = view({ cap: 1000, items: [{ itemId: 'timber', have: 5000, keep: 0 }] });
    expect(row(lots, 'timber').maxLots).toBe(MAX_LOTS);
  });

  it("reuses the swap tab's countdown for the cap card", () => {
    const resetsAt = '2026-11-05T07:00:00.000Z';
    expect(hoursToReset(view({ resetsAt }), Date.parse('2026-11-05T01:30:00.000Z'))).toBe(6);
    expect(SELL_TEXT.resetsIn(1)).toBe('More selling in less than an hour');
  });
});

describe('the Sell basket (#655)', () => {
  it('stepping a row in and out of the basket keeps row order and clamps to max lots / spare copies', () => {
    const v = view({ cap: 1000 });
    // Tapped out of order: the lines still come in row order.
    let basket = tap(v, empty, 'rainbow-scarf', 1);
    basket = tap(v, basket, 'timber', 9); // 4 lots is all 23 Timber gives
    basket = tap(v, basket, 'pom-pom-beanie', 5); // 3 spares: the 4th copy stays
    expect(basketLines(basket, sellRows(v))).toEqual([
      { kind: 'item', itemId: 'timber', lots: 4 },
      { kind: 'clothing', itemId: 'pom-pom-beanie', count: 3 },
      { kind: 'clothing', itemId: 'rainbow-scarf', count: 1 },
    ]);
    // A row short of a lot never goes in.
    expect(tap(v, basket, 'stone', 1)).toBe(basket);
    // − to 0 takes it out of the basket.
    basket = tap(v, basket, 'rainbow-scarf', 1, -1);
    expect(basket.has('clothing:rainbow-scarf')).toBe(false);
    expect(tap(v, basket, 'rainbow-scarf', 1, -1).has('clothing:rainbow-scarf')).toBe(false);
  });

  it("stops + at today's room for the whole basket", () => {
    // 8 💛 of room: a cape (5) leaves 3, so one beanie (2) fits and a second doesn't;
    // then one Timber lot (1) fills it.
    const v = view({ soldToday: 22 });
    let basket = tap(v, empty, 'cloud-cape', 1);
    basket = tap(v, basket, 'pom-pom-beanie', 3);
    expect(basketLines(basket, sellRows(v))).toEqual([
      { kind: 'clothing', itemId: 'cloud-cape', count: 1 },
      { kind: 'clothing', itemId: 'pom-pom-beanie', count: 1 },
    ]);
    expect(canAdd(v, basket, row(v, 'timber'), sellRows(v))).toBe(true);
    basket = tap(v, basket, 'timber', 5);
    expect(basketTotals(basketLines(basket, sellRows(v))).coins).toBe(sellRoom(v));
    expect(canAdd(v, basket, row(v, 'timber'), sellRows(v))).toBe(false);
  });

  it('basket totals count items, not rows, and the cap meter after-line', () => {
    const v = view();
    const basket = fill(v, [
      ['timber', 2],
      ['pom-pom-beanie', 3],
    ]);
    const lines = basketLines(basket, sellRows(v));
    // 10 Timber and 3 beanies: 13 things, 2 + 6 💛.
    expect(basketTotals(lines)).toEqual({ quantity: 13, coins: 8 });
    expect(SELL_TEXT.things(13)).toBe('13 things');
    expect(SELL_TEXT.things(1)).toBe('1 thing');
    expect(SELL_TEXT.meterAfter(v, 8)).toBe('💛 4 → 12 of 30 today');
    expect(SELL_TEXT.meterNow(v)).toBe('💛 4 of 30 today · 26 to go');
    expect(SELL_TEXT.meterNow(view({ soldToday: 30 }))).toBe('💛 30 of 30 today');
    expect(capMeter(v, 8)).toEqual({ now: 4 / 30, after: 12 / 30 });
    expect(capMeter(v, 99).after).toBe(1);
  });

  it('sellRequest builds a basket body in row order', () => {
    const v = view();
    const basket = fill(v, [
      ['rainbow-scarf', 2],
      ['timber', 1],
    ]);
    expect(sellRequest(basketLines(basket, sellRows(v)), { q: 1, r: -2 })).toEqual({
      kind: 'basket',
      q: 1,
      r: -2,
      lines: [
        { kind: 'item', itemId: 'timber', lots: 1 },
        { kind: 'clothing', itemId: 'rainbow-scarf', count: 2 },
      ],
    });
  });

  it('clamping a basket to a smaller room keeps lines and reduces counts', () => {
    const v = view();
    const basket = fill(v, [
      ['timber', 4],
      ['pom-pom-beanie', 3],
      ['rainbow-scarf', 2],
    ]);
    // Another device sold: 7 💛 of room. Row order: 4 Timber lots (4), then one beanie (2).
    const later = view({ soldToday: 23 });
    expect(basketLines(clampBasket(later, basket), sellRows(later))).toEqual([
      { kind: 'item', itemId: 'timber', lots: 4 },
      { kind: 'clothing', itemId: 'pom-pom-beanie', count: 1 },
    ]);
    // A patch-mate's offer named a beanie: its spares drop from 3 to 2.
    const wanted = view({
      clothing: [
        { itemId: 'cloud-cape', copies: 2 },
        { itemId: 'pom-pom-beanie', copies: 3 },
        { itemId: 'rainbow-scarf', copies: 3 },
      ],
    });
    expect(clampBasket(wanted, basket).get('clothing:pom-pom-beanie')).toBe(2);
    // Capped from another device: nothing is left to sell.
    expect(clampBasket(view({ soldToday: 30 }), basket).size).toBe(0);
  });
});

describe('✨ Sell all spares (#655)', () => {
  it('sparesPlan mirrors the shared planner for the view', () => {
    for (const soldToday of [0, 12, 22, 27, 30]) {
      const v = view({ soldToday });
      expect(sparesPlan(v)).toEqual(planSpareClothing(v, SELL_RULES, rarityOf));
    }
    // Plenty of room: every spare, one of each kept.
    expect(sparesPlan(view())).toEqual([
      { kind: 'clothing', itemId: 'cloud-cape', count: 1 },
      { kind: 'clothing', itemId: 'pom-pom-beanie', count: 3 },
      { kind: 'clothing', itemId: 'rainbow-scarf', count: 2 },
    ]);
    expect(hasSpares(view())).toBe(true);
    expect(hasSpares(view({ clothing: [] }))).toBe(false);
  });

  it("says what won't fit, from the planner's own lines", () => {
    // 8 💛 of room: the cape (5) first, then one scarf (3); the beanies wait.
    const v = view({ soldToday: 22 });
    const plan = sparesPlan(v);
    expect(plan).toEqual([
      { kind: 'clothing', itemId: 'cloud-cape', count: 1 },
      { kind: 'clothing', itemId: 'rainbow-scarf', count: 1 },
    ]);
    expect(sparesLeftOut(v, plan)).toEqual(['3 Pom-Pom Beanies', '1 Rainbow Scarf']);
    expect(sparesLeftOut(view(), sparesPlan(view()))).toEqual([]);
  });

  it('names counts kid-style', () => {
    expect(countOf('item', 'timber', 10)).toBe('10 Timber');
    expect(countOf('clothing', 'cloud-cape', 1)).toBe('1 Cloud Cape');
    expect(countOf('clothing', 'rainbow-scarf', 2)).toBe('2 Rainbow Scarves');
    expect(countOf('clothing', 'pom-pom-beanie', 3)).toBe('3 Pom-Pom Beanies');
  });
});

describe('the confirm sheet (#655)', () => {
  it('lists every line, the total in things and the no-undo line', () => {
    const v = view();
    const basket = fill(v, [
      ['timber', 2],
      ['pom-pom-beanie', 3],
    ]);
    const sheet = confirmContent(v, 'basket', basket);
    expect(sheet).toMatchObject({
      title: 'Sell these? 🏷️',
      rows: [
        { text: '10 Timber', right: '2 💛' },
        { text: '3 Pom-Pom Beanies', right: '6 💛' },
      ],
      total: { left: '13 things', right: '+8 💛' },
      after: "You'll have 20 💛 after.",
      stays: [],
      note: 'No take-backs on a sale!',
    });
    expect(sheet?.lines).toEqual(basketLines(basket, sellRows(v)));
    expect(confirmContent(v, 'basket', empty)).toBeNull();
  });

  it("✨ Sell all spares shows the planner's lines, what stays, and the trim", () => {
    const v = view({ soldToday: 22 });
    const sheet = confirmContent(v, 'spares', empty);
    expect(sheet?.lines).toEqual(sparesPlan(v));
    expect(sheet).toMatchObject({
      title: 'Sell all spares? ✨',
      rows: [
        { text: '1 Cloud Cape', right: '5 💛' },
        { text: '1 Rainbow Scarf', right: '3 💛' },
      ],
      total: { left: '2 things', right: '+8 💛' },
      after: '💛 30 of 30 today. All full!',
      stays: [
        'Keeps 1 of each ✨ · Skips anything in a trade.',
        "3 Pom-Pom Beanies and 1 Rainbow Scarf won't fit today. They'll wait for you!",
      ],
    });
    // Room for it all: no trim line.
    expect(confirmContent(view(), 'spares', empty)?.stays).toEqual([SELL_TEXT.sparesKeep]);
    expect(confirmContent(view(), 'spares', empty)?.after).toBe('💛 21 of 30 today.');
    // Nothing fits today: no sheet.
    expect(confirmContent(view({ soldToday: 30 }), 'spares', empty)).toBeNull();
  });

  it('a sale\'s "Yay" card names every line', () => {
    const sold = {
      lines: [
        { kind: 'item' as const, itemId: 'timber', quantity: 10, coins: 2 },
        { kind: 'clothing' as const, itemId: 'pom-pom-beanie', quantity: 3, coins: 6 },
      ],
      quantity: 13,
      coins: 8,
    };
    expect(SELL_TEXT.done(sold)).toBe('Yay! +8 💛 for your patch!');
    expect(SELL_TEXT.doneLines(sold)).toBe('10 Timber and 3 Pom-Pom Beanies sold.');
  });

  it("matches the server's messages", () => {
    // modules/post-sell MESSAGES.capped and .wontFit: change both together.
    expect(SELL_TEXT.capped).toBe("You've sold enough for today! Come back tomorrow. 🌙");
    expect(SELL_TEXT.wontFitNow).toBe("Some of that won't fit today. Let's look again!");
  });
});
