import type { RecipeBookPage } from '../recipe-book/index.js';
import type { ClothingRarity } from '../schemas/data/clothing.js';
import type { SellRules } from '../schemas/data/trading.js';

// Selling extras to the trading post for Heart Coins (#601 PR 3; #320 part 1).
// Pure: the server prices and checks every sale with these, and the Sell tab
// (#601 PR 4) shows the same numbers.

/** Heart Coins for `lots` lots of an item, or null if the post doesn't buy it. */
export function itemSalePrice(rules: SellRules, itemId: string, lots: number): number | null {
  const price = rules.items[itemId];
  return price ? price.coins * lots : null;
}

/** How many of an item `lots` lots are, or null if the post doesn't buy it. */
export function itemSaleQuantity(rules: SellRules, itemId: string, lots: number): number | null {
  const price = rules.items[itemId];
  return price ? price.lot * lots : null;
}

/** Heart Coins for one spare clothing piece of this rarity. */
export const clothingSalePrice = (rules: SellRules, rarity: ClothingRarity): number =>
  rules.clothing[rarity];

/**
 * How many of an item the post leaves in the bag so one craft always stays
 * possible (#320 "your last of a resource needed for a recipe"): the most any
 * single open recipe page uses. 0 if no open recipe needs it.
 */
export function recipeKeep(
  itemId: string,
  pages: readonly Pick<RecipeBookPage, 'key' | 'kind' | 'ingredients'>[],
  open: ReadonlySet<string>,
): number {
  let keep = 0;
  for (const page of pages) {
    if (page.kind !== 'recipe' || !open.has(page.key)) continue;
    keep = Math.max(keep, page.ingredients[itemId] ?? 0);
  }
  return keep;
}

/** Whole lots the post can take from `have`, leaving `keep` behind. */
export const sellableLots = (have: number, keep: number, lot: number): number =>
  Math.max(0, Math.floor((have - keep) / lot));

/** Spare copies of a clothing piece: every free copy but the last one. */
export const spareCopies = (copies: number): number => Math.max(0, copies - 1);
