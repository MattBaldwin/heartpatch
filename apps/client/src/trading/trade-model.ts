import {
  CLOTHING_BY_ID,
  GAME_DATA,
  quickMessageById,
  TRADE_RULES,
  type MailboxEntry,
  type SendOfferRequest,
  type TradeKind,
  type TradeLine,
  type TradeLineView,
  type TradeOfferView,
  type TradesView,
  type WsEventMessage,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';

// The trading post's screen (#271; the owner-approved mockup, screens d, e
// and f) in words and picks. Pure, so every case is unit-tested. The server
// checks everything again (CLAUDE.md rule 1): this only shapes the request
// and says what's waiting. Copy follows docs/STYLE_GUIDE.md.

export type PostTab = 'trade' | 'gift' | 'mailbox';
export const POST_TABS: readonly PostTab[] = ['trade', 'gift', 'mailbox'];

const SPECIES = new Map(GAME_DATA.species.map((s) => [s.id, s]));
const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));

/** One clothing slot's little picture. */
const SLOT_ICONS: Readonly<Record<string, string>> = {
  hat: '🎩',
  'hair-accessory': '🎀',
  top: '👕',
  bottom: '👖',
  shoes: '👟',
  back: '🎒',
  held: '🧸',
  costume: '🎭',
  squishy: '🧣',
};

/** Notes are quick-message presets, never typed text (design doc §17). */
export const NOTE_IDS = ['want-to-trade', 'thank-you', 'so-cute', 'hi', 'heart', 'sparkles'];

export const TRADE_TEXT = {
  tabs: { trade: '🔁 Trade', gift: '🎁 Gift', mailbox: '📬 Mailbox' } satisfies Record<
    PostTab,
    string
  >,
  connected: '🔗 Connected',
  open: (ms: number) => `⏳ Open ${String(Math.max(1, Math.ceil(ms / 60_000)))} min`,
  closed: 'Your visit is over. Win the journey again to come back!',
  close: 'Close',
  tradeWith: 'Trade with',
  giftTo: 'Gift to',
  noMates: 'No patch-mates yet. Invite a friend to trade with!',
  youGive: 'You give',
  youWant: 'You’d like',
  pickGift: 'Pick a gift',
  nothingToGive: 'Nothing ready to trade right now.',
  nothingTheyHave: 'They have nothing ready to trade right now.',
  addNote: 'Add a note:',
  sendOffer: 'Send offer',
  sendGift: 'Send gift 🎁',
  waitsSafely: (name: string) => `Your things wait safely at the post until ${name} answers.`,
  giftWaits: (name: string) => `${name} picks it up at any trading post.`,
  wantsToTrade: (name: string) => `${name} wants to trade!`,
  youGet: 'you get',
  theyGet: (name: string) => `${name} gets`,
  sayYes: 'Say yes! 🤝',
  noThanks: 'No thanks',
  waitingFor: (name: string) => `Waiting for ${name} to answer`,
  callOff: 'Call it off',
  sent: (name: string) => `Sent! ${name} will see it at a trading post. 💌`,
  giftSent: (name: string) => `Gift sent! ${name} can pick it up at any post. 🎁`,
  traded: 'Yay, you traded! 🎉 Your new things wait in your mailbox.',
  declined: 'No problem! Their things went back home.',
  calledOff: 'Called off. Your things are back home.',
  pickUp: 'Pick up',
  pickUpAll: 'Pick up everything',
  pickedUp: 'All picked up! 🎉',
  emptyMailbox: 'Your mailbox is empty. Check back later!',
  mailboxEverywhere:
    'Your mailbox opens at every trading post. The nearest one is the easiest trip!',
  giftFrom: (name: string) => `A gift from ${name}!`,
  tradeDone: (name: string) => `Your trade with ${name} is done!`,
  cameBack: (what: string) => `↩️ ${what} came straight back to you.`,
  mystery: 'Mystery squishy',
  someone: 'A patch-mate',
  tradingOff: 'Trading is taking a nap on this patch. Ask the patch owner!',
  pickBoth: 'Pick something to give, and something to ask for!',
  pickOne: 'Pick something to give!',
  tooMany: `That’s a lot! Up to ${String(TRADE_RULES.linesPerSide)} things on each side.`,
  tooManySquishies: `Up to ${String(TRADE_RULES.squishiesPerSide)} squishies on each side.`,
} as const;

/** How a line looks: a little picture, its name, and a small line under it. */
export interface LineLook {
  readonly icon: string;
  readonly name: string;
  readonly sub: string;
  /** The species colour for a squishy's blob, or null. */
  readonly color: string | null;
}

export function lineLook(line: TradeLineView): LineLook {
  if (line.kind === 'squishy') {
    const species = line.speciesId === null ? undefined : SPECIES.get(line.speciesId);
    const name = line.nickname ?? species?.name ?? TRADE_TEXT.mystery;
    return {
      icon: species ? '' : '❔',
      name,
      sub: `Lv ${String(line.level)}`,
      color: species?.visual.palette[0] ?? null,
    };
  }
  if (line.kind === 'item') {
    const name = RESOURCES.get(line.itemId)?.name ?? line.itemId;
    return {
      icon: itemIcon(line.itemId),
      name: `${name} ×${String(line.quantity)}`,
      sub: '',
      color: null,
    };
  }
  const item = CLOTHING_BY_ID.get(line.itemId);
  return {
    icon: SLOT_ICONS[item?.slot ?? 'hat'] ?? '✨',
    name: item?.name ?? line.itemId,
    sub: '',
    color: null,
  };
}

/** A few lines in words: "Fizz, Timber ×3 and Pom-Pom Beanie". */
export function linesInWords(lines: readonly TradeLineView[]): string {
  const names = lines.map((l) => lineLook(l).name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** A line's identity on a side: the same squishy, piece or item twice is one pick. */
export function lineKey(line: TradeLine | TradeLineView): string {
  if (line.kind === 'squishy') return `s:${line.squishyId}`;
  if (line.kind === 'clothing') return `c:${line.clothingId}`;
  return `i:${line.itemId}`;
}

/** Just what the request needs (the view's extras dropped). */
export function toLine(line: TradeLineView): TradeLine {
  if (line.kind === 'squishy') return { kind: 'squishy', squishyId: line.squishyId };
  if (line.kind === 'clothing') return { kind: 'clothing', clothingId: line.clothingId };
  return { kind: 'item', itemId: line.itemId, quantity: line.quantity };
}

/**
 * Taps a thing on the shelf: a squishy or piece goes on the list or comes
 * off; an item goes on as 1, or comes off.
 */
export function togglePick(picks: readonly TradeLine[], shelfLine: TradeLineView): TradeLine[] {
  const key = lineKey(shelfLine);
  if (picks.some((p) => lineKey(p) === key)) return picks.filter((p) => lineKey(p) !== key);
  const line = toLine(shelfLine);
  return [...picks, line.kind === 'item' ? { ...line, quantity: 1 } : line];
}

/** One more or one less of an item on the list, from 1 up to what's on the shelf. */
export function stepItem(
  picks: readonly TradeLine[],
  itemId: string,
  delta: 1 | -1,
  max: number,
): TradeLine[] {
  return picks.map((p) =>
    p.kind === 'item' && p.itemId === itemId
      ? { ...p, quantity: Math.min(max, Math.max(1, p.quantity + delta)) }
      : p,
  );
}

/** Why the send button waits, or null when it's ready (the server checks again). */
export function sendProblem(
  kind: TradeKind,
  give: readonly TradeLine[],
  want: readonly TradeLine[],
): string | null {
  const squishies = (lines: readonly TradeLine[]) =>
    lines.filter((l) => l.kind === 'squishy').length;
  if (give.length === 0) return kind === 'gift' ? TRADE_TEXT.pickOne : TRADE_TEXT.pickBoth;
  if (kind === 'trade' && want.length === 0) return TRADE_TEXT.pickBoth;
  if (give.length > TRADE_RULES.linesPerSide || want.length > TRADE_RULES.linesPerSide) {
    return TRADE_TEXT.tooMany;
  }
  if (
    squishies(give) > TRADE_RULES.squishiesPerSide ||
    squishies(want) > TRADE_RULES.squishiesPerSide
  ) {
    return TRADE_TEXT.tooManySquishies;
  }
  return null;
}

/** The request for "Send offer" / "Send gift" at the post at (q, r). */
export function offerRequest(
  at: { q: number; r: number },
  kind: TradeKind,
  toUserId: string,
  give: readonly TradeLine[],
  want: readonly TradeLine[],
  noteId: string | null,
): SendOfferRequest {
  return {
    q: at.q,
    r: at.r,
    kind,
    toUserId,
    give: [...give],
    want: kind === 'gift' ? [] : [...want],
    noteId,
  };
}

/** A note's words or emoji ("Want to trade?", "💖"), or null for one this client doesn't know. */
export function noteText(noteId: string | null): string | null {
  if (noteId === null) return null;
  const note = quickMessageById(noteId);
  if (!note) return null;
  if (note.kind === 'phrase') return note.line;
  if (note.kind === 'emoji') return note.emoji;
  return note.name;
}

/** Open trades waiting for my answer. */
export const offersToMe = (view: TradesView, me: string): TradeOfferView[] =>
  view.offers.filter((o) => o.status === 'open' && o.kind === 'trade' && o.toUserId === me);

/** My own open offers and gifts, waiting on someone. */
export const offersFromMe = (view: TradesView, me: string, kind: TradeKind): TradeOfferView[] =>
  view.offers.filter((o) => o.status === 'open' && o.kind === kind && o.fromUserId === me);

/** What waits in my mailbox to pick up. */
export const waiting = (view: TradesView): MailboxEntry[] =>
  view.mailbox.filter((m) => m.pickedUpAt === null && m.kind !== 'return');

/** The tabs' little number badges. */
export function tabBadges(view: TradesView | null, me: string): Record<PostTab, number> {
  if (!view) return { trade: 0, gift: 0, mailbox: 0 };
  return { trade: offersToMe(view, me).length, gift: 0, mailbox: waiting(view).length };
}

/** A mailbox entry's title. */
export function mailboxTitle(entry: MailboxEntry, nameOf: (id: string) => string): string {
  return entry.kind === 'gift'
    ? TRADE_TEXT.giftFrom(nameOf(entry.fromUserId))
    : TRADE_TEXT.tradeDone(nameOf(entry.fromUserId));
}

/** The header chip: connected, or the visit pass counting down; null once a pass ran out. */
export function postChip(passUntil: string | null, nowMs: number): string | null {
  if (passUntil === null) return TRADE_TEXT.connected;
  const left = Date.parse(passUntil) - nowMs;
  return left > 0 ? TRADE_TEXT.open(left) : null;
}

const TRADE_EVENTS = new Set([
  'trade.offered',
  'trade.answered',
  'trade.cancelled',
  'trade.expired',
  'gift.collected',
  'mailbox.collected',
]);

/** A live event that changes what my post screen shows (mine, as one of the two players). */
export function tradeEventForMe(event: WsEventMessage, me: string): boolean {
  if (!TRADE_EVENTS.has(event.type)) return false;
  const data = event.data as Partial<Record<'fromUserId' | 'toUserId' | 'userId', unknown>>;
  return data.fromUserId === me || data.toUserId === me || data.userId === me;
}
