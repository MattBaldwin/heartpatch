import { CLOTHING_BY_ID, SELL_RULES, type SellView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { hoursToReset } from './glimmer-swap-model.js';
import {
  clampLots,
  MAX_LOTS,
  pickTotals,
  SELL_TEXT,
  sellCapped,
  sellLabel,
  sellRequest,
  sellRoom,
  sellRows,
} from './sell-model.js';

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
  clothing: [{ itemId: 'pom-pom-beanie', copies: 3 }],
  ...over,
});

const row = (v: SellView, itemId: string) => {
  const found = sellRows(v).find((r) => r.itemId === itemId);
  if (!found) throw new Error(`no row for ${itemId}`);
  return found;
};

describe('the Sell tab (#601 PR 4)', () => {
  it('lists my bag stacks in the server order, then my spare clothing', () => {
    expect(sellRows(view()).map((r) => [r.kind, r.itemId])).toEqual([
      ['item', 'timber'],
      ['item', 'stone'],
      ['item', 'greens'],
      ['item', 'glimmer'],
      ['clothing', 'pom-pom-beanie'],
    ]);
  });

  it('prices a lot from the shared rules', () => {
    const timber = row(view(), 'timber');
    expect(timber).toMatchObject({ name: 'Timber', lot: SELL_RULES.items['timber']?.lot });
    expect(timber.coins).toBe(SELL_RULES.items['timber']?.coins);
    const piece = CLOTHING_BY_ID.get('pom-pom-beanie');
    expect(row(view(), 'pom-pom-beanie').coins).toBe(
      SELL_RULES.clothing[piece?.rarity ?? 'common'],
    );
  });

  it('sells only whole lots', () => {
    // 23 Timber in lots of 5: four lots, three left over.
    expect(row(view(), 'timber')).toMatchObject({ maxLots: 4, block: 'ok' });
  });

  it('keeps what a recipe needs, and says so', () => {
    // 8 Stone, 4 kept: one lot of 5 would leave 3.
    const stone = row(view(), 'stone');
    expect(stone).toMatchObject({ maxLots: 0, block: 'keep' });
    expect(stone.keepLine).toBe('Keeping 4 for recipes');
    // With 9, one lot goes and 4 stay.
    const more = view({ items: [{ itemId: 'stone', have: 9, keep: 4 }] });
    expect(row(more, 'stone')).toMatchObject({ maxLots: 1, block: 'ok' });
    expect(row(view(), 'timber').keepLine).toBeNull();
  });

  it('asks for a whole lot when there is not one', () => {
    expect(row(view(), 'greens')).toMatchObject({ maxLots: 0, block: 'short', need: 5 });
  });

  it('counts what a recipe keeps in what I need', () => {
    // 3 Stone, 4 kept: a lot of 5 needs 9 in the bag, not 5.
    const few = view({ items: [{ itemId: 'stone', have: 3, keep: 4 }] });
    expect(row(few, 'stone')).toMatchObject({ maxLots: 0, need: 9 });
    expect(row(view(), 'stone').need).toBe(9);
  });

  it("stops at today's 💛 cap", () => {
    // 2 💛 left: two Timber lots (1 each), one Glimmer (2), the beanie (2) fits.
    const near = view({ soldToday: 28 });
    expect(sellRoom(near)).toBe(2);
    expect(row(near, 'timber')).toMatchObject({ maxLots: 2, block: 'ok' });
    expect(row(near, 'glimmer')).toMatchObject({ maxLots: 1 });
    const full = view({ soldToday: 30 });
    expect(sellCapped(full)).toBe(true);
    expect(sellRows(full).every((r) => r.maxLots === 0 && r.block !== 'ok')).toBe(true);
    expect(row(full, 'timber').block).toBe('cap');
    expect(sellCapped(view())).toBe(false);
  });

  it('never sells the last copy of a piece, one spare a sale', () => {
    expect(row(view(), 'pom-pom-beanie')).toMatchObject({ maxLots: 1, have: 3, lot: 1 });
  });

  it('caps one sale at the request limit', () => {
    const lots = view({ cap: 1000, items: [{ itemId: 'timber', have: 5000, keep: 0 }] });
    expect(row(lots, 'timber').maxLots).toBe(MAX_LOTS);
  });

  it('keeps the stepper between one lot and the most I can sell', () => {
    const timber = row(view(), 'timber');
    expect(clampLots(0, timber)).toBe(1);
    expect(clampLots(3, timber)).toBe(3);
    expect(clampLots(9, timber)).toBe(4);
  });

  it('says what a sale takes and pays before it happens', () => {
    const pick = { kind: 'item', itemId: 'timber', lots: 2 } as const;
    const { quantity, coins } = pickTotals(pick, row(view(), 'timber'));
    expect([quantity, coins]).toEqual([10, 2]);
    expect(SELL_TEXT.confirm(quantity, 'timber', coins)).toBe('Sell 10 Timber for 2 💛?');
    expect(SELL_TEXT.today(view())).toBe('💛 4 of 30 today');
  });

  it('asks the server for lots of an item, or one piece', () => {
    expect(sellRequest({ kind: 'item', itemId: 'timber', lots: 2 }, { q: 1, r: -2 })).toEqual({
      kind: 'item',
      q: 1,
      r: -2,
      itemId: 'timber',
      lots: 2,
    });
    expect(
      sellRequest({ kind: 'clothing', itemId: 'pom-pom-beanie', lots: 1 }, { q: 0, r: 0 }),
    ).toEqual({ kind: 'clothing', q: 0, r: 0, itemId: 'pom-pom-beanie' });
  });

  it("reuses the swap tab's countdown for the cap card", () => {
    const resetsAt = '2026-11-05T07:00:00.000Z';
    expect(hoursToReset(view({ resetsAt }), Date.parse('2026-11-05T01:30:00.000Z'))).toBe(6);
    expect(SELL_TEXT.resetsIn(1)).toBe('More selling in less than an hour');
  });

  it('says "Need N" on every row that can\'t sell yet, never a greyed Sell', () => {
    const v = view();
    // Timber 8 with 4 kept: one lot of 5 needs 9 (the owner's success shot).
    const kept = view({ items: [{ itemId: 'timber', have: 8, keep: 4 }] });
    expect(sellLabel(row(kept, 'timber'), false)).toBe('Need 9');
    expect(sellLabel(row(v, 'stone'), false)).toBe('Need 9');
    expect(sellLabel(row(v, 'greens'), false)).toBe('Need 5');
    expect(sellLabel(row(v, 'timber'), false)).toBe('Sell');
  });

  it('says "Tomorrow" when only today\'s 💛 stops a row, and "Sell" once all are capped', () => {
    // 1 💛 left: a Timber lot (1) fits, Glimmer (2) doesn't.
    const near = view({ soldToday: 29 });
    expect(sellLabel(row(near, 'glimmer'), sellCapped(near))).toBe('Tomorrow');
    expect(sellLabel(row(near, 'timber'), sellCapped(near))).toBe('Sell');
    const full = view({ soldToday: 30 });
    expect(sellLabel(row(full, 'timber'), sellCapped(full))).toBe('Sell');
    // Short beats the cap: the kid still needs more first.
    expect(sellLabel(row(full, 'greens'), sellCapped(full))).toBe('Need 5');
  });

  it("matches the server's cap message", () => {
    // modules/post-sell MESSAGES.capped: change both together.
    expect(SELL_TEXT.capped).toBe("You've sold enough for today! Come back tomorrow. 🌙");
  });
});
