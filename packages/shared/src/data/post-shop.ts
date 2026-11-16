import type { PostShop, PostShopItem, PostShopItemId } from '../schemas/data/post-shop.js';

/**
 * The trading post's Shop (#729, owner decision 2026-11-15): five
 * consumables, priced in Heart Coins on the patch. Checked by
 * `checkPostShop` in tests. `pnpm sim:patch-economy` says a casual kid nets
 * about 777 a week after upkeep, so two Lures a week are about a third of it.
 */
export const POST_SHOP: PostShop = [
  {
    id: 'rare-lure',
    price: 120, // TUNE: #729 plan §1, a weekly treat
    effect: { kind: 'lure' },
    cap: { count: 2, per: 'week' }, // TUNE: rolling 7 patch days
    held: 1,
  },
  {
    id: 'heart-charm-pack',
    price: 40, // TUNE: five charms; they sell for 2 each, so 4x their worth
    effect: { kind: 'items', items: { 'heart-charm': 5 } },
    cap: { count: 1, per: 'day' }, // TUNE:
  },
  {
    id: 'potion-crate',
    price: 60, // TUNE: one of each battle potion
    effect: { kind: 'items', items: { 'brave-brew': 1, 'cozy-cocoa': 1, 'hearty-soup': 1 } },
    cap: { count: 1, per: 'day' }, // TUNE:
  },
  {
    id: 'night-supplies',
    price: 80, // TUNE: #729 table
    effect: { kind: 'fuel-all', nights: 3 }, // TUNE: each fire takes only what fits
    // TUNE: "1 per Long Night" as the rolling 7 patch days (729b ruling)
    cap: { count: 1, per: 'week' },
  },
  {
    id: 'fence-patch-kit',
    price: 50, // TUNE: #729 table
    effect: { kind: 'repair-fences' },
    cap: { count: 1, per: 'day' }, // TUNE:
  },
];

/** A Shop item by id. */
export const POST_SHOP_BY_ID: ReadonlyMap<PostShopItemId, PostShopItem> = new Map(
  POST_SHOP.map((item) => [item.id, item]),
);
