import { describe, expect, it } from 'vitest';
import { checkPostShop, PostShopSchema } from '../schemas/data/post-shop.js';
import { POST_SHOP } from './post-shop.js';
import { RESOURCES } from './resources.js';
import { SELL_RULES } from './trading.js';

/** Heart Coins the post pays for one of an item. */
const sellValue = (itemId: string) => {
  const price = SELL_RULES.items[itemId];
  return price ? price.coins / price.lot : 0;
};
const check = (input: unknown) => checkPostShop(input, RESOURCES, sellValue);

describe('POST_SHOP (#729)', () => {
  it('every item parses and ids are unique', () => {
    expect(PostShopSchema.safeParse(POST_SHOP).success).toBe(true);
    expect(check(POST_SHOP)).toEqual([]);
    expect(check([...POST_SHOP, POST_SHOP[0]]).join('\n')).toMatch(/listed twice/);
  });

  it('pack and crate items are known resources', () => {
    const broken = POST_SHOP.map((item) =>
      item.id === 'potion-crate'
        ? { ...item, effect: { kind: 'items' as const, items: { 'not-a-thing': 1 } } }
        : item,
    );
    expect(check(broken).join('\n')).toMatch(/unknown item "not-a-thing"/);
  });

  it("a pack's price is at least twice its contents' sell value", () => {
    for (const item of POST_SHOP) {
      if (item.effect.kind !== 'items') continue;
      const worth = Object.entries(item.effect.items).reduce(
        (n, [id, count]) => n + sellValue(id) * count,
        0,
      );
      expect(worth, item.id).toBeGreaterThan(0);
      expect(item.price, item.id).toBeGreaterThanOrEqual(worth * 2);
    }
    const cheap = POST_SHOP.map((item) =>
      item.id === 'heart-charm-pack' ? { ...item, price: 19 } : item,
    );
    expect(check(cheap).join('\n')).toMatch(/under twice/);
  });

  it('held only on the lure', () => {
    expect(POST_SHOP.filter((item) => item.held !== undefined).map((i) => i.id)).toEqual([
      'rare-lure',
    ]);
    const held = POST_SHOP.map((item) =>
      item.id === 'potion-crate' ? { ...item, held: 1 as const } : item,
    );
    expect(check(held).join('\n')).toMatch(/only a lure is held/);
  });

  it('caps match the owner decision (lure 2 a rolling week, packs 1 a day)', () => {
    const caps = Object.fromEntries(POST_SHOP.map((i) => [i.id, i.cap]));
    expect(caps).toEqual({
      'rare-lure': { count: 2, per: 'week' },
      'heart-charm-pack': { count: 1, per: 'day' },
      'potion-crate': { count: 1, per: 'day' },
    });
  });
});
