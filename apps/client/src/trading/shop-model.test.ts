import type { BuyResponse, ShopItemView, ShopView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  buyRequest,
  confirmContent,
  daysUntil,
  receipt,
  shopCards,
  SHOP_TEXT,
} from './shop-model.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const item = (over: Partial<ShopItemView> & Pick<ShopItemView, 'id'>): ShopItemView => ({
  price: 120,
  left: 2,
  nextAt: null,
  status: 'buy',
  ...over,
});
const view = (items: ShopItemView[], balance = 240, lureHeld = false): ShopView => ({
  items,
  balance,
  lureHeld,
});

describe('shopCards', () => {
  it('lists one card per item, in the server order, with the server price', () => {
    const cards = shopCards(
      view([item({ id: 'rare-lure' }), item({ id: 'heart-charm-pack', price: 40 })]),
      NOW,
    );
    expect(cards.map((c) => [c.id, c.price, c.canBuy, c.cap])).toEqual([
      ['rare-lure', 120, true, '2 a week'],
      ['heart-charm-pack', 40, true, '1 a day'],
    ]);
    expect(cards[0]?.state).toBeNull();
    expect(cards[0]?.why).toBeNull();
  });

  it('says how many more 💛 an item needs, and that selling helps for the lure', () => {
    const [lure, pack] = shopCards(
      view([item({ id: 'rare-lure' }), item({ id: 'heart-charm-pack', price: 40 })], 30),
      NOW,
    );
    expect(lure?.canBuy).toBe(false);
    expect(lure?.why).toBe('Need 💛 90 more. Selling helps!');
    expect(pack?.why).toBe('Need 💛 10 more');
  });

  it('can buy at exactly the price', () => {
    const [card] = shopCards(view([item({ id: 'rare-lure' })], 120), NOW);
    expect(card?.canBuy).toBe(true);
  });

  it('a held lure is a cream card with the lilac note and a greyed Buy', () => {
    const [card] = shopCards(view([item({ id: 'rare-lure', status: 'held' })], 500, true), NOW);
    expect(card).toMatchObject({ cream: true, canBuy: false, why: null });
    expect(card?.state).toEqual({ text: "You've got a lure waiting ✨", glow: true });
  });

  it('a capped day item is back tomorrow', () => {
    const [card] = shopCards(
      view([item({ id: 'potion-crate', price: 60, status: 'capped', left: 0 })]),
      NOW,
    );
    expect(card?.state).toEqual({ text: 'Back tomorrow! 🌙', glow: false });
    expect(card).toMatchObject({ cream: true, canBuy: false });
  });

  it('a capped lure says when the next one comes, in days', () => {
    const at = (days: number) => new Date(NOW + days * 86_400_000 - 1000).toISOString();
    const text = (days: number) =>
      shopCards(
        view([item({ id: 'rare-lure', status: 'capped', left: 0, nextAt: at(days) })]),
        NOW,
      )[0]?.state?.text;
    expect(text(3)).toBe('Two a week is plenty! Next one in 3 days');
    expect(text(1)).toBe('Two a week is plenty! Next one in 1 day');
  });
});

describe('daysUntil', () => {
  it('rounds up and is at least a day', () => {
    expect(daysUntil(new Date(NOW + 1).toISOString(), NOW)).toBe(1);
    expect(daysUntil(new Date(NOW - 5000).toISOString(), NOW)).toBe(1);
    expect(daysUntil(null, NOW)).toBe(1);
    expect(daysUntil(new Date(NOW + 86_400_001).toISOString(), NOW)).toBe(2);
  });
});

describe('buy', () => {
  it('names the item and the post, never a price', () => {
    expect(buyRequest('rare-lure', { q: 2, r: -1 })).toEqual({ q: 2, r: -1, itemId: 'rare-lure' });
  });

  it('the confirm says what it costs and what is left after', () => {
    const [card] = shopCards(view([item({ id: 'rare-lure' })], 240), NOW);
    if (!card) throw new Error('no card');
    const c = confirmContent(card, 240);
    expect(c.title).toBe('Buy a Rare Lure for 💛 120?');
    expect(c.rows).toEqual([{ icon: '🔮', text: 'Rare Lure', right: '💛 120' }]);
    expect(c.after).toBe("You'll have 💛 120 after.");
    expect(SHOP_TEXT.confirmTitle('Heart Charm pack', 40)).toBe(
      'Buy a Heart Charm pack for 💛 40?',
    );
  });

  it('the receipt says a lure is ready, or what landed in the bag', () => {
    const base = { balance: 120, shop: view([]) };
    const lure: BuyResponse = {
      ...base,
      bought: { itemId: 'rare-lure', price: 120, got: { kind: 'lure' } },
    };
    expect(receipt(lure).title).toBe('Got it! Your lure is ready ✨');
    const pack: BuyResponse = {
      ...base,
      bought: {
        itemId: 'heart-charm-pack',
        price: 40,
        got: { kind: 'items', items: { 'heart-charm': 5 } },
      },
    };
    expect(receipt(pack).line).toBe('5 Heart Charms');
  });
});
