import {
  basketTotal,
  CLOTHING_BY_ID,
  clothingSalePrice,
  GAME_DATA,
  planSpareClothing,
  pluralName,
  SELL_RULES,
  sellableLots,
  sellRoom,
  spareCopies,
  type RarityOf,
  type SellBasketRequest,
  type SellBasketResponse,
  type SellLine,
  type SellRules,
  type SellView,
} from '@heartpatch/shared';
import { clothingSlotIcon, itemIcon } from '../inventory/item-icons.js';

// The trading post's Sell tab (#601 PR 4; #655 part C): extras from the bag
// and spare clothing for 💛 Heart Coins, picked into one basket with a − N +
// on each row and sold in one go. Prices and lots are shared data
// (`SELL_RULES`, the same `sellableLots`, `spareCopies` and `basketTotal`
// the server uses); the server checks every basket again (CLAUDE.md rule 1).
// Pure, so it's tested without a DOM.

export { sellRoom };

const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const nameOf = (itemId: string) =>
  RESOURCES.get(itemId)?.name ?? CLOTHING_BY_ID.get(itemId)?.name ?? itemId;

/** A piece's rarity if the post buys it (tradable clothing only), as the server prices it. */
export const rarityOf: RarityOf = (itemId) => {
  const piece = CLOTHING_BY_ID.get(itemId);
  return piece?.tradable ? piece.rarity : undefined;
};

/** The most lots of an item, and spares of a piece, one line takes (`SellLineSchema`). */
export const MAX_LOTS = 100;
export const MAX_PIECES = 50;
/** The most lines one basket takes (`SellBasketRequestSchema`). */
export const MAX_LINES = 40;

/** "1 Ghost Cape", "3 Pumpkin Hoods", "2 Cozy Scarves", "10 Timber". */
export function countOf(kind: SellLine['kind'], itemId: string, n: number): string {
  const name = nameOf(itemId);
  if (kind === 'item' || n === 1) return `${String(n)} ${name}`;
  // `pluralName` covers -s and -y; a clothing name can also end in -f or -ch.
  const many = name.endsWith('f')
    ? `${name.slice(0, -1)}ves`
    : /(ch|sh|x)$/.test(name)
      ? `${name}es`
      : pluralName(name);
  return `${String(n)} ${many}`;
}

/** "A, B and C". */
const inWords = (parts: readonly string[]) =>
  parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;

// Kid-readable words (style guide §2): short, warm, no stats-speak.
export const SELL_TEXT = {
  today: (view: Pick<SellView, 'soldToday' | 'cap'>) =>
    `💛 ${String(view.soldToday)} of ${String(view.cap)} today`,
  have: (n: number) => `Have ${String(n)}`,
  spare: (n: number) => `${String(n)} spare`,
  price: (lot: number, coins: number) =>
    lot === 1 ? `${String(coins)} 💛 each` : `${String(lot)} for ${String(coins)} 💛`,
  keeping: (n: number) => `Keeps ${String(n)} for your recipes`,
  coins: (n: number) => `${String(n)} 💛`,
  need: (n: number) => `Need ${String(n)}`,
  /** A row today's 💛 can't fit, while cheaper ones still can. */
  tomorrow: 'Tomorrow',
  less: (name: string) => `One less ${name}`,
  more: (name: string) => `One more ${name}`,
  clothingHead: 'Spare clothing',
  keepsOne: 'Keeps 1 of each',
  spares: '✨ Sell all spares',
  // The bar.
  nothingPicked: 'Nothing picked yet',
  things: (n: number) => (n === 1 ? '1 thing' : `${String(n)} things`),
  meterNow: (view: Pick<SellView, 'soldToday' | 'cap'>) => {
    const left = sellRoom(view);
    return `${SELL_TEXT.today(view)}${left > 0 ? ` · ${String(left)} to go` : ''}`;
  },
  meterAfter: (view: Pick<SellView, 'soldToday' | 'cap'>, coins: number) =>
    `💛 ${String(view.soldToday)} → ${String(view.soldToday + coins)} of ${String(view.cap)} today`,
  sell: 'Sell',
  // The confirm sheet.
  confirmTitle: 'Sell these? 🏷️',
  sparesTitle: 'Sell all spares? ✨',
  plus: (coins: number) => `+${String(coins)} 💛`,
  balanceAfter: (coins: number) => `You'll have ${String(coins)} 💛 after.`,
  /** Today's 💛 after ✨ Sell all spares; when the room trimmed it, how close to full. */
  todayAfter: (after: number, cap: number, trimmed: boolean) =>
    `💛 ${String(after)} of ${String(cap)} today.${
      after >= cap ? ' All full!' : trimmed ? ' Nearly there!' : ''
    }`,
  sparesKeep: 'Keeps 1 of each ✨ · Skips anything in a trade.',
  wontFit: (lines: readonly string[]) => `${inWords(lines)} won't fit today. They'll wait for you!`,
  noUndo: 'No take-backs on a sale!',
  yes: 'Sell!',
  no: 'Not now',
  done: (sold: SellBasketResponse['sold']) => `Yay! +${String(sold.coins)} 💛 for your patch!`,
  doneLines: (sold: SellBasketResponse['sold']) =>
    `${inWords(sold.lines.map((l) => countOf(l.kind, l.itemId, l.quantity)))} sold.`,
  // The server's messages too (modules/post-sell MESSAGES): change both together.
  // The bar shows the server's own text; these pin the contract in the tests.
  capped: "You've sold enough for today! Come back tomorrow. 🌙",
  wontFitNow: "Some of that won't fit today. Let's look again!",
  resetsIn: (hours: number) =>
    hours <= 1 ? 'More selling in less than an hour' : `More selling in ${String(hours)} hours`,
  nothing: 'Nothing to sell yet. Gather some extras and come back!',
  stays: 'Tools, Heartdust and your only copy of a piece stay with you 💕',
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
  /** How many I need to sell one lot: a lot plus what a recipe keeps. */
  readonly need: number;
  /** How many one lot is: 1 for a piece. */
  readonly lot: number;
  /** 💛 for one lot. */
  readonly coins: number;
  /** The most lots the bag (or my spares) lets one line take, room aside. 0 = none. */
  readonly maxLots: number;
  readonly block: SellBlock;
  /** "Keeps 4 for your recipes", when a recipe holds some back. */
  readonly keepLine: string | null;
}

/** A row's basket key: one line per (kind, itemId), as the server wants. */
export const rowKey = (row: Pick<SellRow, 'kind' | 'itemId'>) => `${row.kind}:${row.itemId}`;

/** What's in the basket: lots (items) or pieces (clothing) by row key. Empty rows aren't in it. */
export type SellBasket = ReadonlyMap<string, number>;

/** Nothing more sells today: not even the cheapest lot fits. */
export function sellCapped(view: SellView, rules: SellRules = SELL_RULES): boolean {
  const cheapest = Math.min(
    ...Object.values(rules.items).map((p) => p.coins),
    ...Object.values(rules.clothing),
  );
  return sellRoom(view) < cheapest;
}

function blockOf(byStock: number, fits: boolean, short: SellBlock): SellBlock {
  if (byStock === 0) return short;
  return fits ? 'ok' : 'cap';
}

/** The tab's rows: my bag stacks in data order, then spare pieces in the view's (item id) order. */
export function sellRows(view: SellView, rules: SellRules = SELL_RULES): SellRow[] {
  const room = sellRoom(view);
  const items = view.items.flatMap((stack): SellRow[] => {
    const price = rules.items[stack.itemId];
    if (!price) return [];
    const byStock = Math.min(MAX_LOTS, sellableLots(stack.have, stack.keep, price.lot));
    // Some stays for a recipe, and that's what stops a whole lot.
    const kept = stack.keep > 0 && stack.have >= price.lot;
    return [
      {
        kind: 'item',
        itemId: stack.itemId,
        icon: itemIcon(stack.itemId),
        name: nameOf(stack.itemId),
        have: stack.have,
        need: price.lot + stack.keep,
        lot: price.lot,
        coins: price.coins,
        maxLots: byStock,
        block: blockOf(byStock, room >= price.coins, kept ? 'keep' : 'short'),
        keepLine: stack.keep > 0 ? SELL_TEXT.keeping(stack.keep) : null,
      },
    ];
  });
  const pieces = view.clothing.flatMap((piece): SellRow[] => {
    const item = CLOTHING_BY_ID.get(piece.itemId);
    const rarity = rarityOf(piece.itemId);
    if (!item || !rarity) return [];
    const coins = clothingSalePrice(rules, rarity);
    // The first copy always stays.
    const byStock = Math.min(MAX_PIECES, spareCopies(piece.copies));
    return [
      {
        kind: 'clothing',
        itemId: piece.itemId,
        icon: clothingSlotIcon(item.slot),
        name: item.name,
        have: piece.copies,
        need: 2,
        lot: 1,
        coins,
        maxLots: byStock,
        block: blockOf(byStock, room >= coins, 'short'),
        keepLine: null,
      },
    ];
  });
  return [...items, ...pieces];
}

/**
 * What a row's stepper says under its count: the coins it's earning once in
 * the basket; otherwise why it can't sell yet. Short of a lot (with what a
 * recipe keeps) always says "Need N", N being what the bag must hold (owner,
 * #616); a row only today's 💛 stops says "Tomorrow" while cheaper rows still
 * fit. Once nothing fits, the capped card explains, so it's blank.
 */
export function rowNote(
  row: Pick<SellRow, 'block' | 'need' | 'coins'>,
  lots: number,
  capped: boolean,
): string {
  if (lots > 0) return SELL_TEXT.coins(lots * row.coins);
  if (row.block === 'short' || row.block === 'keep') return SELL_TEXT.need(row.need);
  if (row.block === 'cap' && !capped) return SELL_TEXT.tomorrow;
  return '';
}

/** The basket's lines in row order (the request's order), each kept to what its row can sell. */
export function basketLines(basket: SellBasket, rows: readonly SellRow[]): SellLine[] {
  return rows.flatMap((row): SellLine[] => {
    const n = Math.min(basket.get(rowKey(row)) ?? 0, row.maxLots);
    if (n <= 0) return [];
    return row.kind === 'item'
      ? [{ kind: 'item', itemId: row.itemId, lots: n }]
      : [{ kind: 'clothing', itemId: row.itemId, count: n }];
  });
}

/** What some lines sell (items and pieces, not rows) and pay; zero for none. */
export function basketTotals(
  lines: readonly SellLine[],
  rules: SellRules = SELL_RULES,
): { quantity: number; coins: number } {
  return basketTotal(rules, rarityOf, lines) ?? { quantity: 0, coins: 0 };
}

/** A row's count in the basket: lots for an item, pieces for clothing. */
export const lotsIn = (basket: SellBasket, row: Pick<SellRow, 'kind' | 'itemId'>) =>
  basket.get(rowKey(row)) ?? 0;

/**
 * One more lot of a row still fits: the row has it, today's room takes the
 * basket with it, and a new line keeps the basket within its line limit.
 */
export function canAdd(view: SellView, basket: SellBasket, row: SellRow, rows: readonly SellRow[]) {
  const lines = basketLines(basket, rows);
  const { coins } = basketTotals(lines);
  const n = lotsIn(basket, row);
  return (
    n < row.maxLots && coins + row.coins <= sellRoom(view) && (n > 0 || lines.length < MAX_LINES)
  );
}

/**
 * One tap of a row's − or +: + puts it in the basket (or adds a lot) only
 * while it fits; − takes a lot off, and at 0 the row leaves the basket.
 */
export function stepLine(
  view: SellView,
  basket: SellBasket,
  row: SellRow,
  rows: readonly SellRow[],
  delta: 1 | -1,
): SellBasket {
  const n = lotsIn(basket, row);
  if (delta === 1 && !canAdd(view, basket, row, rows)) return basket;
  const next = new Map(basket);
  const lots = Math.max(0, Math.min(n + delta, row.maxLots));
  if (lots === 0) next.delete(rowKey(row));
  else next.set(rowKey(row), lots);
  return next;
}

/**
 * The basket against a fresh view (after a refusal or a sale): each line
 * kept to what its row can sell now, then, in row order, cut to today's room
 * (a line that no longer fits at all drops). Lines stay; only counts shrink.
 */
export function clampBasket(
  view: SellView,
  basket: SellBasket,
  rules: SellRules = SELL_RULES,
): SellBasket {
  let room = sellRoom(view);
  const next = new Map<string, number>();
  for (const row of sellRows(view, rules)) {
    const want = Math.min(basket.get(rowKey(row)) ?? 0, row.maxLots);
    const lots = Math.min(want, Math.floor(room / row.coins));
    if (lots <= 0) continue;
    room -= lots * row.coins;
    next.set(rowKey(row), lots);
  }
  return next;
}

/** The ✨ Sell all spares basket: the shared planner's lines (keeps one, trims to today's room). */
export const sparesPlan = (view: SellView, rules: SellRules = SELL_RULES): SellLine[] =>
  planSpareClothing(view, rules, rarityOf);

/** Spare pieces the post buys at all: the ✨ button only shows when there's one. */
export const hasSpares = (view: SellView): boolean =>
  view.clothing.some((c) => rarityOf(c.itemId) !== undefined && spareCopies(c.copies) > 0);

/**
 * What the spares plan leaves behind because today's room ran out, in row
 * order: "1 Heart Mittens", "3 Pumpkin Hoods". Taken from the planner's own
 * lines, so the sheet says exactly what the request leaves.
 */
export function sparesLeftOut(view: SellView, plan: readonly SellLine[]): string[] {
  return view.clothing.flatMap((piece) => {
    if (!rarityOf(piece.itemId)) return [];
    const planned = plan.find((l) => l.kind === 'clothing' && l.itemId === piece.itemId);
    const left =
      Math.min(MAX_PIECES, spareCopies(piece.copies)) -
      (planned?.kind === 'clothing' ? planned.count : 0);
    return left > 0 ? [countOf('clothing', piece.itemId, left)] : [];
  });
}

/** A confirm line: "10 Timber", "3 Pumpkin Hoods", and what it pays. */
export function lineWords(line: SellLine): { icon: string; text: string; coins: number } {
  const { coins } = basketTotals([line]);
  if (line.kind === 'item') {
    const lot = SELL_RULES.items[line.itemId]?.lot ?? 1;
    return {
      icon: itemIcon(line.itemId),
      text: countOf('item', line.itemId, line.lots * lot),
      coins,
    };
  }
  const slot = CLOTHING_BY_ID.get(line.itemId)?.slot;
  return {
    icon: slot ? clothingSlotIcon(slot) : '👕',
    text: countOf('clothing', line.itemId, line.count),
    coins,
  };
}

/** Which confirm sheet is up: the stepper basket, or ✨ Sell all spares. */
export type SellConfirm = 'basket' | 'spares';

/**
 * What a confirm sheet says (#655, mockup v4 screens 2 and 3): every line
 * and what it pays, the total in things (not rows), the purse after (or, for
 * ✨ Sell all spares, today's cap after and what stays and why). The lines are
 * exactly the request's. Null when there's nothing to sell.
 */
export function confirmContent(view: SellView, which: SellConfirm, basket: SellBasket) {
  const plan = sparesPlan(view);
  const lines = which === 'spares' ? plan : basketLines(basket, sellRows(view));
  if (lines.length === 0) return null;
  const total = basketTotals(lines);
  const left = which === 'spares' ? sparesLeftOut(view, plan) : [];
  return {
    lines,
    title: which === 'spares' ? SELL_TEXT.sparesTitle : SELL_TEXT.confirmTitle,
    rows: lines.map((line) => {
      const words = lineWords(line);
      return { icon: words.icon, text: words.text, right: SELL_TEXT.coins(words.coins) };
    }),
    total: { left: SELL_TEXT.things(total.quantity), right: SELL_TEXT.plus(total.coins) },
    after:
      which === 'spares'
        ? SELL_TEXT.todayAfter(view.soldToday + total.coins, view.cap, left.length > 0)
        : SELL_TEXT.balanceAfter(view.balance + total.coins),
    stays:
      which === 'spares'
        ? [SELL_TEXT.sparesKeep, ...(left.length > 0 ? [SELL_TEXT.wontFit(left)] : [])]
        : [],
    note: SELL_TEXT.noUndo,
  };
}

/** The bar's cap meter: today so far, and after this basket, as parts of the cap (0–1). */
export function capMeter(view: Pick<SellView, 'soldToday' | 'cap'>, coins: number) {
  const part = (n: number) => Math.max(0, Math.min(1, n / view.cap));
  return { now: part(view.soldToday), after: part(view.soldToday + coins) };
}

/** The request for some lines at the post at (q, r). */
export function sellRequest(
  lines: readonly SellLine[],
  at: { q: number; r: number },
): SellBasketRequest {
  return { kind: 'basket', q: at.q, r: at.r, lines: [...lines] };
}
