import type { RecipeBookPage } from '../recipe-book/index.js';
import { CLOTHING_RARITIES, type ClothingRarity } from '../schemas/data/clothing.js';
import type { SellRules } from '../schemas/data/trading.js';
import type { SellLine, SellView } from '../schemas/trading.js';

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

/**
 * A clothing piece's rarity, or undefined if the post doesn't buy it
 * (unknown or untradable). Callers build it from the clothing catalog.
 */
export type RarityOf = (itemId: string) => ClothingRarity | undefined;

/** How many of an item or pieces one basket line is, and what it pays; null if the post doesn't buy it. */
export function linePrice(
  rules: SellRules,
  rarityOf: RarityOf,
  line: SellLine,
): { quantity: number; coins: number } | null {
  if (line.kind === 'clothing') {
    const rarity = rarityOf(line.itemId);
    return rarity
      ? { quantity: line.count, coins: clothingSalePrice(rules, rarity) * line.count }
      : null;
  }
  if (rules.neverSold.includes(line.itemId)) return null;
  const quantity = itemSaleQuantity(rules, line.itemId, line.lots);
  const coins = itemSalePrice(rules, line.itemId, line.lots);
  return quantity === null || coins === null ? null : { quantity, coins };
}

/**
 * What a basket sells in all (items and pieces, not lines) and pays (#655),
 * or null if any line is something the post doesn't buy.
 */
export function basketTotal(
  rules: SellRules,
  rarityOf: RarityOf,
  lines: readonly SellLine[],
): { quantity: number; coins: number } | null {
  let quantity = 0;
  let coins = 0;
  for (const line of lines) {
    const price = linePrice(rules, rarityOf, line);
    if (!price) return null;
    quantity += price.quantity;
    coins += price.coins;
  }
  return { quantity, coins };
}

/** Heart Coins I can still earn selling today: the cap less what's sold. */
export const sellRoom = (view: Pick<SellView, 'cap' | 'soldToday'>): number =>
  Math.max(0, view.cap - view.soldToday);

/** Why a basket can't sell as it stands, checked against the Sell tab; the server is the authority. */
export type BasketProblem = 'dup' | 'notBought' | 'keep' | 'lastCopy' | 'capped';

/**
 * The client's pre-check of a basket against the view (#655): a repeated
 * line, something the post doesn't buy, an item line that would dip below
 * the keep (or past what's in the bag), a clothing line that would take the
 * last free copy, or a total past today's room. null if it looks fine.
 */
export function basketProblem(
  view: SellView,
  rules: SellRules,
  rarityOf: RarityOf,
  lines: readonly SellLine[],
): BasketProblem | null {
  if (new Set(lines.map((l) => `${l.kind}:${l.itemId}`)).size !== lines.length) return 'dup';
  const total = basketTotal(rules, rarityOf, lines);
  if (!total) return 'notBought';
  for (const line of lines) {
    if (line.kind === 'item') {
      const stack = view.items.find((s) => s.itemId === line.itemId);
      const lot = rules.items[line.itemId]!.lot;
      if (!stack || line.lots > sellableLots(stack.have, stack.keep, lot)) return 'keep';
    } else {
      const piece = view.clothing.find((c) => c.itemId === line.itemId);
      if (!piece || line.count > spareCopies(piece.copies)) return 'lastCopy';
    }
  }
  return total.coins > sellRoom(view) ? 'capped' : null;
}

/** Most spares of one piece in a line, and most lines in a basket (`SellBasketRequestSchema`). */
const MAX_PIECES_PER_LINE = 50;
const MAX_LINES = 40;

/**
 * "Sell all spares" (#655): every spare clothing piece in the view (all but
 * one free copy, so a piece an open offer holds is never counted), trimmed to
 * today's room. Trimming takes rarer pieces first (they earn the most from a
 * capped day), then the view's row order, cutting a line's count to what
 * fits and skipping on to cheaper ones. Lines come back in row order, so the
 * preview is the request. Deterministic. // TUNE: the trimming order.
 */
export function planSpareClothing(
  view: SellView,
  rules: SellRules,
  rarityOf: RarityOf,
): SellLine[] {
  const rank = (rarity: ClothingRarity) => CLOTHING_RARITIES.indexOf(rarity);
  const candidates = view.clothing.flatMap((piece, row) => {
    const rarity = rarityOf(piece.itemId);
    const spare = Math.min(MAX_PIECES_PER_LINE, spareCopies(piece.copies));
    return rarity && spare > 0 ? [{ itemId: piece.itemId, row, rarity, spare }] : [];
  });
  candidates.sort((a, b) => rank(b.rarity) - rank(a.rarity) || a.row - b.row);
  let room = sellRoom(view);
  const picked: { row: number; line: SellLine }[] = [];
  for (const c of candidates) {
    if (picked.length === MAX_LINES) break;
    const count = Math.min(c.spare, Math.floor(room / clothingSalePrice(rules, c.rarity)));
    if (count === 0) continue;
    room -= count * clothingSalePrice(rules, c.rarity);
    picked.push({ row: c.row, line: { kind: 'clothing', itemId: c.itemId, count } });
  }
  return picked.sort((a, b) => a.row - b.row).map((p) => p.line);
}
