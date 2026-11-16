import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { PostShopItemIdSchema } from './data/post-shop.js';
import { ItemCountsSchema } from './inventory.js';
import { queryInt } from './query.js';

/*
 * The trading post's Shop (#729): consumables bought with Heart Coins at a
 * post the player can use. The server prices, caps and applies every
 * purchase (CLAUDE.md rules 1 and 7); the client only names the item.
 */

/**
 * One Shop card.
 * - `buy`: on sale and under its cap (the price may still be more than the balance).
 * - `capped`: bought as often as its cap allows; `nextAt` says when the next one is.
 * - `held`: a Rare Lure is waiting unused; another can't be bought until it's used.
 */
export const ShopItemViewSchema = z.object({
  id: PostShopItemIdSchema,
  /** Heart Coins. */
  price: z.number().int().min(1),
  /** How many more the cap allows now. */
  left: z.number().int().min(0),
  /** When the cap next lets one more through (the patch's midnight, or a week-old purchase dropping off); null when not capped. */
  nextAt: z.iso.datetime().nullable(),
  status: z.enum(['buy', 'capped', 'held']),
});
export type ShopItemView = z.infer<typeof ShopItemViewSchema>;

export const ShopViewSchema = z.object({
  items: z.array(ShopItemViewSchema),
  /** A Rare Lure is waiting for my next wild find on this patch (the Find a squishy glow). */
  lureHeld: z.boolean(),
  /** My Heart Coins on this patch. */
  balance: z.number().int().min(0),
});
export type ShopView = z.infer<typeof ShopViewSchema>;

export const ShopViewResponseSchema = z.object({ shop: ShopViewSchema });
export type ShopViewResponse = z.infer<typeof ShopViewResponseSchema>;

/** `GET /maps/:mapId/posts/shop?q=&r=`: the post I'm shopping at. */
export const ShopQuerySchema = z.object({
  q: queryInt({ min: -32768, max: 32767 }),
  r: queryInt({ min: -32768, max: 32767 }),
});
export type ShopQuery = z.infer<typeof ShopQuerySchema>;

/** `POST /maps/:mapId/posts/shop` (with an `Idempotency-Key`): one item from the post at (q, r). */
export const BuyRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  itemId: PostShopItemIdSchema,
});
export type BuyRequest = z.infer<typeof BuyRequestSchema>;

/**
 * What a purchase gave: things in the bag, a Rare Lure held, fuel in my
 * fires (`fires` that took some, `nights` added across them), or my fences
 * mended (`fences` segments back to full).
 */
export const ShopGotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('items'), items: ItemCountsSchema }),
  z.object({ kind: z.literal('lure') }),
  z.object({
    kind: z.literal('fuel-all'),
    fires: z.number().int().min(1),
    nights: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('repair-fences'), fences: z.number().int().min(1) }),
]);
export type ShopGot = z.infer<typeof ShopGotSchema>;

export const BuyResponseSchema = z.object({
  bought: z.object({
    itemId: PostShopItemIdSchema,
    price: z.number().int().min(1),
    got: ShopGotSchema,
  }),
  balance: z.number().int().min(0),
  shop: ShopViewSchema,
});
export type BuyResponse = z.infer<typeof BuyResponseSchema>;
