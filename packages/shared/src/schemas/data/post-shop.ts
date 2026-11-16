import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';
import { isTradableResource, type Resource } from './resources.js';

// The trading post's Shop (#729): consumables bought with Heart Coins on this
// patch, never traded, gifted or refunded. Priced in Heart Coins only (Patch
// Coins stay the Boutique's, DECISIONS F). Night supplies and the Fence
// patch kit (729b) work on what the buyer already has on the patch.

/** What the Shop sells, by id. */
export const PostShopItemIdSchema = z.enum([
  'rare-lure',
  'heart-charm-pack',
  'potion-crate',
  'night-supplies',
  'fence-patch-kit',
]);
export type PostShopItemId = z.infer<typeof PostShopItemIdSchema>;

/**
 * What a purchase does.
 * - `lure`: the buyer's next wild encounter on the patch rolls one rarity tier
 *   up, held until a wild start uses it.
 * - `items`: these go straight into the buyer's bag on the patch.
 * - `fuel-all`: `nights` of fuel to every Hearthfire the buyer owns on the
 *   patch, each only as much as fits (`fuelSpace`).
 * - `repair-fences`: every fence segment the buyer owns on the patch back to full.
 */
export const PostShopEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('lure') }),
  z.strictObject({
    kind: z.literal('items'),
    items: z.record(ContentIdSchema, z.number().int().min(1).max(99)),
  }),
  z.strictObject({ kind: z.literal('fuel-all'), nights: z.number().int().min(1).max(14) }),
  z.strictObject({ kind: z.literal('repair-fences') }),
]);
export type PostShopEffect = z.infer<typeof PostShopEffectSchema>;

/**
 * How often one player can buy an item on one patch, on the patch's own day
 * (`maps.time_zone`): `day` counts today's purchases; `week` counts the last
 * 7 patch days including today (rolling, owner decision 2026-11-15).
 */
export const PostShopCapSchema = z.strictObject({
  count: z.number().int().min(1).max(20),
  per: z.enum(['day', 'week']),
});
export type PostShopCap = z.infer<typeof PostShopCapSchema>;

export const PostShopItemSchema = z.strictObject({
  id: PostShopItemIdSchema,
  /** Heart Coins. */
  price: z.number().int().min(1).max(1000),
  effect: PostShopEffectSchema,
  cap: PostShopCapSchema,
  /** How many a player can hold unused at once (the lure only). */
  held: z.literal(1).optional(),
});
export type PostShopItem = z.infer<typeof PostShopItemSchema>;

export const PostShopSchema = z.array(PostShopItemSchema).min(1);
export type PostShop = z.infer<typeof PostShopSchema>;

/**
 * Readable problems with the Shop's data, or `[]`: ids are unique, `items`
 * name known tradable resources, `held` comes only with a lure, and each
 * pack costs at least twice what its contents sell for at the post (so
 * nobody buys packs to sell the pieces). `sellValue` is Heart Coins for one
 * of an item at the post (0 if it doesn't buy it).
 */
export function checkPostShop(
  input: unknown,
  resources: readonly Pick<Resource, 'id' | 'tradable'>[],
  sellValue: (itemId: string) => number,
): string[] {
  const result = PostShopSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const problems: string[] = [];
  const byId = new Map(resources.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const item of result.data) {
    if (seen.has(item.id)) problems.push(`${item.id}: listed twice`);
    seen.add(item.id);
    if (item.held !== undefined && item.effect.kind !== 'lure') {
      problems.push(`${item.id}: only a lure is held`);
    }
    if (item.effect.kind !== 'items') continue;
    let worth = 0;
    for (const [id, n] of Object.entries(item.effect.items)) {
      const resource = byId.get(id);
      if (!resource) problems.push(`${item.id}: unknown item "${id}"`);
      else if (!isTradableResource(resource))
        problems.push(`${item.id}: "${id}" stays with its Keeper`);
      worth += sellValue(id) * n;
    }
    if (item.price < worth * 2) {
      problems.push(
        `${item.id}: costs ${String(item.price)}, under twice what it sells for (${String(worth)})`,
      );
    }
  }
  return problems;
}
