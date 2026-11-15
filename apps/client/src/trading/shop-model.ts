import {
  GAME_DATA,
  pluralName,
  POST_SHOP_BY_ID,
  type BuyRequest,
  type BuyResponse,
  type PostShopItemId,
  type ShopItemView,
  type ShopView,
} from '@heartpatch/shared';

// The trading post's Shop tab (#729; the owner-approved mockup v3) in words
// and picks. Pure, so every case is unit-tested. Prices, caps and what's
// buyable come from the server's `ShopView` (CLAUDE.md rule 1): this only
// says what the card shows. A refusal is the server's own message.

/** Per item: the picture, the name and the one kid line (copy, not rules). */
export const SHOP_ITEMS: Record<
  PostShopItemId,
  { readonly icon: string; readonly name: string; readonly line: string }
> = {
  'rare-lure': { icon: '🔮', name: 'Rare Lure', line: 'Your next wild find leans rarer!' },
  'heart-charm-pack': {
    icon: '💖',
    name: 'Heart Charm pack',
    line: '5 Heart Charms for befriending.',
  },
  'potion-crate': {
    icon: '📦',
    name: 'Potion crate',
    line: 'Brave Brew, Cozy Cocoa and Hearty Soup.',
  },
};

const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r.name]));
const DAY_MS = 86_400_000;
const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five'];

export const SHOP_TEXT = {
  balance: 'Your Heart Coins',
  buy: 'Buy',
  loading: '…',
  /** An older server without the Shop (plan §9). */
  closed: 'The shop is closed right now',
  heldWaiting: "You've got a lure waiting ✨",
  backTomorrow: 'Back tomorrow! 🌙',
  backSoon: 'Back soon!',
  sellingHelps: 'Selling helps!',
  yes: 'Buy',
  no: 'Not now',
  noUndo: 'Coins spent are spent.',
  lureReady: 'Got it! Your lure is ready ✨',
  lureReadyLine: 'Tap Find a squishy to go looking.',
  got: 'Got it! ✨',
  needMore: (n: number) => `Need 💛 ${String(n)} more`,
  capLabel: (count: number, per: 'day' | 'week') => `${String(count)} a ${per}`,
  /** "Two a week is plenty! Next one in 3 days". */
  weekFull: (count: number, days: number) =>
    `${WORDS[count] ?? String(count)} a week is plenty! Next one in ${String(days)} ${days === 1 ? 'day' : 'days'}`,
  confirmTitle: (name: string, price: number) => `Buy ${aOrAn(name)} for 💛 ${String(price)}?`,
  after: (coins: number) => `You'll have 💛 ${String(coins)} after.`,
  price: (n: number) => `💛 ${String(n)}`,
} as const;

function aOrAn(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** What a card says and whether its Buy works. */
export interface ShopCard {
  readonly id: PostShopItemId;
  readonly icon: string;
  readonly name: string;
  readonly line: string;
  readonly cap: string;
  readonly price: number;
  /** Cream card: capped or held (the price stays visible, Buy greyed). */
  readonly cream: boolean;
  /** The state pill: "Back tomorrow! 🌙", the lure-waiting note. */
  readonly state: { readonly text: string; readonly glow: boolean } | null;
  /** Under the price: "Need 💛 90 more". */
  readonly why: string | null;
  readonly canBuy: boolean;
}

/** Whole days (rounded up, at least 1) until `nextAt`. */
export function daysUntil(nextAt: string | null, nowMs: number): number {
  if (nextAt === null) return 1;
  return Math.max(1, Math.ceil((Date.parse(nextAt) - nowMs) / DAY_MS));
}

/** One card per item the server listed, in its order. */
export function shopCards(view: ShopView, nowMs: number): ShopCard[] {
  return view.items.map((item) => cardOf(item, view.balance, nowMs));
}

function cardOf(item: ShopItemView, balance: number, nowMs: number): ShopCard {
  const copy = SHOP_ITEMS[item.id];
  const cap = POST_SHOP_BY_ID.get(item.id)?.cap;
  const base = {
    id: item.id,
    ...copy,
    cap: cap ? SHOP_TEXT.capLabel(cap.count, cap.per) : '',
    price: item.price,
  };
  if (item.status === 'held') {
    return {
      ...base,
      cream: true,
      state: { text: SHOP_TEXT.heldWaiting, glow: true },
      why: null,
      canBuy: false,
    };
  }
  if (item.status === 'capped') {
    const text =
      cap?.per === 'week'
        ? SHOP_TEXT.weekFull(cap.count, daysUntil(item.nextAt, nowMs))
        : item.nextAt === null && cap?.per !== 'day'
          ? SHOP_TEXT.backSoon
          : SHOP_TEXT.backTomorrow;
    return { ...base, cream: true, state: { text, glow: false }, why: null, canBuy: false };
  }
  const short = item.price - balance;
  return {
    ...base,
    cream: false,
    state: null,
    why:
      short > 0
        ? item.id === 'rare-lure'
          ? `${SHOP_TEXT.needMore(short)}. ${SHOP_TEXT.sellingHelps}`
          : SHOP_TEXT.needMore(short)
        : null,
    canBuy: short <= 0,
  };
}

export const buyRequest = (id: PostShopItemId, at: { q: number; r: number }): BuyRequest => ({
  q: at.q,
  r: at.r,
  itemId: id,
});

/** What the confirm sheet says about one card. */
export function confirmContent(card: ShopCard, balance: number) {
  return {
    title: SHOP_TEXT.confirmTitle(card.name, card.price),
    rows: [{ icon: card.icon, text: card.name, right: SHOP_TEXT.price(card.price) }],
    line: card.line,
    after: SHOP_TEXT.after(Math.max(0, balance - card.price)),
  };
}

/** The green receipt card after a buy. */
export function receipt(res: BuyResponse): { title: string; line: string } {
  if (res.bought.got.kind === 'lure') {
    return { title: SHOP_TEXT.lureReady, line: SHOP_TEXT.lureReadyLine };
  }
  const parts = Object.entries(res.bought.got.items).map(
    ([id, n]) =>
      `${String(n)} ${n === 1 ? (RESOURCES.get(id) ?? id) : pluralName(RESOURCES.get(id) ?? id)}`,
  );
  return { title: SHOP_TEXT.got, line: parts.join(', ') };
}
