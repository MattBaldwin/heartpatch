import {
  CLOTHING_BY_ID,
  clothingSalePrice,
  GAME_DATA,
  SELL_RULES,
  sellableLots,
  spareCopies,
  type SellRequest,
  type SellResponse,
  type SellRules,
  type SellView,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';
import { clothingIcon } from './trade-model.js';

// The trading post's Sell tab (#601 PR 4; #320 part 1): extras from the bag
// and spare clothing for 💛 Heart Coins. Prices and lots are shared data
// (`SELL_RULES`, the same `sellableLots` and `spareCopies` the server uses);
// the server checks every sale again (CLAUDE.md rule 1). Pure, so it's tested
// without a DOM.

const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const nameOf = (itemId: string) =>
  RESOURCES.get(itemId)?.name ?? CLOTHING_BY_ID.get(itemId)?.name ?? itemId;

/** The most lots one sale takes (`SellRequestSchema`). */
export const MAX_LOTS = 100;

// Kid-readable words (style guide §2): short, warm, no stats-speak.
export const SELL_TEXT = {
  intro: 'Sell your extras for 💛 Heart Coins!',
  today: (view: Pick<SellView, 'soldToday' | 'cap'>) =>
    `💛 ${String(view.soldToday)} of ${String(view.cap)} today`,
  have: (n: number) => `You have ${String(n)}`,
  copies: (n: number) => `You have ${String(n)}`,
  price: (quantity: number, coins: number) => `· ${String(quantity)} for ${String(coins)} 💛`,
  keeping: (n: number) => `Keeping ${String(n)} for recipes`,
  sell: 'Sell',
  need: (n: number) => `Need ${String(n)}`,
  confirm: (quantity: number, itemId: string, coins: number) =>
    `Sell ${String(quantity)} ${nameOf(itemId)} for ${String(coins)} 💛?`,
  noUndo: "Once it's sold, it's sold!",
  less: 'Less',
  more: 'More',
  yes: 'Sell!',
  no: 'Not now',
  done: (sold: SellResponse['sold']) => `Yay! +${String(sold.coins)} 💛 for your patch!`,
  doneLine: (sold: SellResponse['sold']) => `${String(sold.quantity)} ${nameOf(sold.itemId)} sold.`,
  // The server's cap message too (modules/post-sell): change both together.
  capped: "You've sold enough for today! Come back tomorrow. 🌙",
  resetsIn: (hours: number) =>
    hours <= 1 ? 'More selling in less than an hour' : `More selling in ${String(hours)} hours`,
  nothing: 'Nothing to sell yet. Gather some extras and come back!',
  stays: 'Tools, Heartdust and your only copy of a piece stay with you.',
} as const;

/** Why a row can't sell right now, or `ok`. */
export type SellBlock = 'ok' | 'cap' | 'keep' | 'short';

/** One thing the post buys from me: a bag stack, or a piece I have spares of. */
export interface SellRow {
  readonly kind: 'item' | 'clothing';
  readonly itemId: string;
  readonly icon: string;
  readonly name: string;
  /** In my bag (an item), or free copies (a piece). */
  readonly have: number;
  /** How many one lot is: 1 for a piece. */
  readonly lot: number;
  /** 💛 for one lot. */
  readonly coins: number;
  /** The most lots I can sell now: what the keep leaves, and today's room. 0 = none. */
  readonly maxLots: number;
  readonly block: SellBlock;
  /** "Keeping 4 for recipes", when a recipe holds some back. */
  readonly keepLine: string | null;
}

/** The pick waiting on its confirm: what, and how many lots. */
export interface SellPick {
  readonly kind: 'item' | 'clothing';
  readonly itemId: string;
  readonly lots: number;
}

/** 💛 I can still earn selling today. */
export const sellRoom = (view: Pick<SellView, 'soldToday' | 'cap'>) =>
  Math.max(0, view.cap - view.soldToday);

/** Nothing more sells today: not even the cheapest lot fits. */
export function sellCapped(view: SellView, rules: SellRules = SELL_RULES): boolean {
  const cheapest = Math.min(
    ...Object.values(rules.items).map((p) => p.coins),
    ...Object.values(rules.clothing),
  );
  return sellRoom(view) < cheapest;
}

function blockOf(byStock: number, byRoom: number, short: SellBlock): SellBlock {
  if (byStock === 0) return short;
  return byRoom === 0 ? 'cap' : 'ok';
}

/** The tab's rows: my bag stacks in data order, then spare pieces. */
export function sellRows(view: SellView, rules: SellRules = SELL_RULES): SellRow[] {
  const room = sellRoom(view);
  const items = view.items.flatMap((stack): SellRow[] => {
    const price = rules.items[stack.itemId];
    if (!price) return [];
    const byStock = Math.min(MAX_LOTS, sellableLots(stack.have, stack.keep, price.lot));
    const byRoom = Math.floor(room / price.coins);
    // Some stays for a recipe, and that's what stops a whole lot.
    const kept = stack.keep > 0 && stack.have >= price.lot;
    return [
      {
        kind: 'item',
        itemId: stack.itemId,
        icon: itemIcon(stack.itemId),
        name: nameOf(stack.itemId),
        have: stack.have,
        lot: price.lot,
        coins: price.coins,
        maxLots: Math.min(byStock, byRoom),
        block: blockOf(byStock, byRoom, kept ? 'keep' : 'short'),
        keepLine: stack.keep > 0 ? SELL_TEXT.keeping(stack.keep) : null,
      },
    ];
  });
  const pieces = view.clothing.flatMap((piece): SellRow[] => {
    const item = CLOTHING_BY_ID.get(piece.itemId);
    if (!item) return [];
    const coins = clothingSalePrice(rules, item.rarity);
    // One spare a sale (the server's rule); the first copy always stays.
    const byStock = Math.min(1, spareCopies(piece.copies));
    const byRoom = room >= coins ? 1 : 0;
    return [
      {
        kind: 'clothing',
        itemId: piece.itemId,
        icon: clothingIcon(item.slot),
        name: item.name,
        have: piece.copies,
        lot: 1,
        coins,
        maxLots: Math.min(byStock, byRoom),
        block: blockOf(byStock, byRoom, 'short'),
        keepLine: null,
      },
    ];
  });
  return [...items, ...pieces];
}

/** A pick's lots kept between 1 and what the row can sell. */
export const clampLots = (lots: number, row: Pick<SellRow, 'maxLots'>): number =>
  Math.max(1, Math.min(lots, row.maxLots));

/** What a pick sells and pays: "Sell 10 Timber for 2 💛?". */
export function pickTotals(pick: SellPick, row: Pick<SellRow, 'lot' | 'coins'>) {
  return { quantity: pick.lots * row.lot, coins: pick.lots * row.coins };
}

/** The request for a pick at the post at (q, r). */
export function sellRequest(pick: SellPick, at: { q: number; r: number }): SellRequest {
  return pick.kind === 'item'
    ? { kind: 'item', q: at.q, r: at.r, itemId: pick.itemId, lots: pick.lots }
    : { kind: 'clothing', q: at.q, r: at.r, itemId: pick.itemId };
}

/** Whole hours (rounded up) until today's selling comes back. */
export function sellHoursToReset(view: Pick<SellView, 'resetsAt'>, nowMs: number): number {
  return Math.max(1, Math.ceil((Date.parse(view.resetsAt) - nowMs) / 3_600_000));
}
