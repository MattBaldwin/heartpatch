import {
  CLOTHING_BY_ID,
  GAME_DATA,
  heartsOf,
  quickMessageById,
  TRADE_RULES,
  TRADE_VALUES,
  tradeBalance,
  tradeValuer,
  type TradeTip,
  type MailboxEntry,
  type SendOfferRequest,
  type TradeKind,
  type TradeLine,
  type TradeLineView,
  type TradeOfferView,
  type TradeShelf,
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
  // The split view (#305): whose things are whose, per-side filter and sort.
  yourThings: 'Your things',
  theirThings: 'Their things',
  otherMate: 'Trade with someone else',
  filters: {
    all: 'All',
    squishies: 'Squishies',
    items: 'Items',
    clothing: 'Clothing',
  } satisfies Record<ShelfFilter, string>,
  sorts: { name: 'A–Z', rarity: 'Rarest', newest: 'Newest' } satisfies Record<ShelfSort, string>,
  show: 'Show',
  sortBy: 'Sort by',
  nothingHere: 'Nothing like that here.',
  // The offer strip and the fairness meter (#305).
  stripGive: 'You give',
  stripGet: 'You get',
  tapYours: 'Tap your things',
  tapTheirs: (name: string) => `Tap ${name}’s things`,
  hearts: (n: number) => `${String(n)} of 5 hearts`,
  pickSides: 'Pick something on each side!',
  fair: 'Fair trade! 💛',
  tipsMe: 'Tips toward you',
  tipsThem: (name: string) => `Tips toward ${name}`,
  wayMoreMe: 'Way more for you',
  wayMoreThem: (name: string) => `Way more for ${name}`,
  askMore: 'Want to ask for more?',
  addMore: (name: string) => `Add something for ${name}?`,
  askMoreButton: 'Ask for more',
  addMoreButton: 'Add from mine',
  kindGive: 'That’s kind! Just check you’re happy.',
  kindGet: 'What a kind offer!',
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

/** The smallest a name may shrink to before it ends in "…" (owner, #271). */
export const NAME_MIN_PX = 10; // TUNE:

/**
 * A name's font size so its longest word fits the box whole (owner decision
 * on the #271 screens: never "Pebblesno-oze"). `widestWord` is that word's
 * width at `fontPx`. Shrinks in half-pixel steps down to `minPx`; past that
 * the name keeps `minPx` and ends in "…" on one line.
 */
export function fitName(
  widestWord: number,
  box: number,
  fontPx: number,
  minPx = NAME_MIN_PX,
): { readonly px: number; readonly ellipsis: boolean } {
  if (widestWord <= box || widestWord <= 0 || box <= 0) return { px: fontPx, ellipsis: false };
  const px = Math.max(minPx, Math.floor(((fontPx * box) / widestWord) * 2) / 2);
  return { px, ellipsis: (widestWord * px) / fontPx > box };
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

// ---- the split view (#305) ------------------------------------------------

export type ShelfFilter = 'all' | 'squishies' | 'items' | 'clothing';
export const SHELF_FILTERS: readonly ShelfFilter[] = ['all', 'squishies', 'items', 'clothing'];
export type ShelfSort = 'name' | 'rarity' | 'newest';
export const SHELF_SORTS: readonly ShelfSort[] = ['name', 'rarity', 'newest'];

/** One of a thing, so "Rarest" ranks a stack by what each one is worth. */
const oneOf = (line: TradeLineView): TradeLineView =>
  line.kind === 'item' ? { ...line, quantity: 1 } : line;

/** Squishies and clothing pieces have time-ordered ids (UUIDv7): the biggest is the newest found. */
const foundAt = (line: TradeLineView): string | null =>
  line.kind === 'squishy' ? line.squishyId : line.kind === 'clothing' ? line.clothingId : null;

/**
 * What one side's shelf shows, filtered and sorted (#305; kept per side while
 * the screen is open). Client-only: the shelf already holds everything that
 * can trade. "Rarest" ranks by what one of each is worth, "Newest" puts the
 * latest squishies and pieces first (items have no date, so they come last,
 * A–Z), and ties go A–Z.
 */
export function shelfLines(
  shelf: TradeShelf,
  filter: ShelfFilter,
  sort: ShelfSort,
): TradeLineView[] {
  const lines: TradeLineView[] =
    filter === 'squishies'
      ? [...shelf.squishies]
      : filter === 'items'
        ? [...shelf.items]
        : filter === 'clothing'
          ? [...shelf.clothing]
          : [...shelf.squishies, ...shelf.items, ...shelf.clothing];
  const byName = (a: TradeLineView, b: TradeLineView) =>
    lineLook(a).name.localeCompare(lineLook(b).name);
  const order = (a: TradeLineView, b: TradeLineView): number => {
    if (sort === 'rarity') {
      const worth = tradeValuer.lineValue(oneOf(b)) - tradeValuer.lineValue(oneOf(a));
      if (worth !== 0) return worth;
    } else if (sort === 'newest') {
      const at = foundAt(a);
      const bt = foundAt(b);
      if (at !== bt) {
        if (at === null) return 1;
        if (bt === null) return -1;
        return at < bt ? 1 : -1;
      }
    }
    return byName(a, b);
  };
  return lines.sort(order);
}

/** My picks as the shelf shows them (with the picked count for an item), to value and draw. */
export function pickedViews(
  picks: readonly TradeLine[],
  shelf: TradeShelf | undefined,
): TradeLineView[] {
  if (!shelf) return [];
  const all: TradeLineView[] = [...shelf.squishies, ...shelf.items, ...shelf.clothing];
  return picks.flatMap((pick) => {
    const line = all.find((l) => lineKey(l) === lineKey(pick));
    if (!line) return [];
    return [
      line.kind === 'item' && pick.kind === 'item' ? { ...line, quantity: pick.quantity } : line,
    ];
  });
}

/** The nudge's shortcut on a lopsided offer: toward their shelf, or mine. */
export type NudgeAction = 'ask' | 'add';

/** How the fairness meter looks (#305). Hearts only, never numbers. */
export interface MeterLook {
  readonly giveHearts: number;
  readonly getHearts: number;
  readonly tip: TradeTip;
  readonly lopsided: boolean;
  /** "Fair trade! 💛", "Tips toward you", … */
  readonly label: string;
  /** The friendly second line on a lopsided offer, or null. */
  readonly sub: string | null;
  /** The sender's shortcut on a lopsided offer, or null. Never blocks sending. */
  readonly nudge: NudgeAction | null;
  /** Where the heart sits, 0 (my end) to 100 (theirs); null until both sides have something. */
  readonly marker: number | null;
  /** The even band's half-width around the middle, in the same units. */
  readonly fairHalf: number;
}

/**
 * The meter for what I give against what I get. `sender` while I build an
 * offer (a lopsided one gets a shortcut), `receiver` on an offer to me (a
 * calm note, no button). The heart slides toward whoever gets more.
 */
export function meterLook(
  give: readonly TradeLineView[],
  get: readonly TradeLineView[],
  mateName: string,
  role: 'sender' | 'receiver',
): MeterLook {
  const giveValue = tradeValuer.sideValue(give);
  const getValue = tradeValuer.sideValue(get);
  const { tip, lopsided } = tradeBalance(giveValue, getValue);
  // Toward my end (0) as I get more; the even band maps onto the middle.
  const lean = tip === 'none' ? 0 : (getValue - giveValue) / (getValue + giveValue);
  const band = TRADE_VALUES.evenBand / (2 - TRADE_VALUES.evenBand);
  const label =
    tip === 'none'
      ? TRADE_TEXT.pickSides
      : tip === 'even'
        ? TRADE_TEXT.fair
        : tip === 'me'
          ? lopsided
            ? TRADE_TEXT.wayMoreMe
            : TRADE_TEXT.tipsMe
          : lopsided
            ? TRADE_TEXT.wayMoreThem(mateName)
            : TRADE_TEXT.tipsThem(mateName);
  const sub = !lopsided
    ? null
    : role === 'receiver'
      ? tip === 'them'
        ? TRADE_TEXT.kindGive
        : TRADE_TEXT.kindGet
      : tip === 'them'
        ? TRADE_TEXT.askMore
        : TRADE_TEXT.addMore(mateName);
  return {
    giveHearts: heartsOf(giveValue),
    getHearts: heartsOf(getValue),
    tip,
    lopsided,
    label,
    sub,
    nudge: role === 'sender' && lopsided ? (tip === 'them' ? 'ask' : 'add') : null,
    marker: tip === 'none' ? null : Math.min(96, Math.max(4, 50 - 50 * lean)),
    fairHalf: 50 * band,
  };
}
