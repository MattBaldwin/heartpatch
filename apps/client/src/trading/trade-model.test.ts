import {
  findAvoidedWords,
  GAME_DATA,
  TRADE_RULES,
  type MailboxEntry,
  type TradeLineView,
  type TradeOfferView,
  type TradeShelf,
  type TradesView,
  type WsEventMessage,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  fitName,
  lineKey,
  lineLook,
  linesInWords,
  mailboxTitle,
  meterLook,
  noteText,
  NOTE_IDS,
  offerRequest,
  offersFromMe,
  offersToMe,
  pickedViews,
  postChip,
  sendProblem,
  shelfLines,
  SHELF_FILTERS,
  SHELF_SORTS,
  stepItem,
  tabBadges,
  togglePick,
  TRADE_TEXT,
  tradeEventForMe,
  waiting,
} from './trade-model.js';

const ME = '00000000-0000-4000-8000-000000000001';
const SAM = '00000000-0000-4000-8000-000000000002';
const KAI = '00000000-0000-4000-8000-000000000003';
const ID = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HERO = GAME_DATA.species[0]!;

type SquishyView = Extract<TradeLineView, { kind: 'squishy' }>;
const squishy = (n: number, speciesId: string | null = HERO.id): SquishyView => ({
  kind: 'squishy',
  squishyId: ID(n),
  speciesId,
  level: 6,
  nickname: null,
});
const timber = (quantity: number): TradeLineView => ({ kind: 'item', itemId: 'timber', quantity });
const hat: TradeLineView = { kind: 'clothing', clothingId: ID(9), itemId: 'pom-pom-beanie' };

const offer = (over: Partial<TradeOfferView>): TradeOfferView => ({
  id: ID(50),
  kind: 'trade',
  fromUserId: SAM,
  toUserId: ME,
  status: 'open',
  noteId: null,
  createdAt: '2026-11-04T16:00:00.000Z',
  expiresAt: '2026-11-07T16:00:00.000Z',
  give: [squishy(1)],
  want: [timber(2)],
  ...over,
});
const mail = (over: Partial<MailboxEntry>): MailboxEntry => ({
  id: ID(70),
  offerId: ID(50),
  kind: 'gift',
  fromUserId: SAM,
  lines: [timber(3)],
  readyAt: '2026-11-04T16:00:00.000Z',
  pickedUpAt: null,
  ...over,
});
const view = (over: Partial<TradesView>): TradesView => ({
  tradingEnabled: true,
  offers: [],
  mailbox: [],
  returns: [],
  now: '2026-11-04T16:00:00.000Z',
  ...over,
});

describe('trade model (#271)', () => {
  it('draws each kind of line, and a secret species as a mystery', () => {
    expect(lineLook(squishy(1))).toMatchObject({ name: HERO.name, sub: 'Lv 6' });
    expect(lineLook(squishy(1)).color).toBe(HERO.visual.palette[0]);
    expect(lineLook({ ...squishy(1), nickname: 'Fizz' }).name).toBe('Fizz');
    expect(lineLook(squishy(2, null))).toMatchObject({ name: 'Mystery squishy', color: null });
    expect(lineLook(timber(3)).name).toBe('Timber ×3');
    expect(lineLook(hat).name).toBe('Pom-Pom Beanie');
    expect(linesInWords([squishy(1), timber(3), hat])).toBe(
      `${HERO.name}, Timber ×3 and Pom-Pom Beanie`,
    );
    expect(linesInWords([hat])).toBe('Pom-Pom Beanie');
  });

  it('picks and unpicks from a shelf, one item at a time up to what’s there', () => {
    let picks = togglePick([], squishy(1));
    picks = togglePick(picks, timber(5));
    expect(picks).toEqual([
      { kind: 'squishy', squishyId: ID(1) },
      { kind: 'item', itemId: 'timber', quantity: 1 },
    ]);
    picks = stepItem(picks, 'timber', 1, 2);
    picks = stepItem(picks, 'timber', 1, 2);
    expect(picks[1]).toEqual({ kind: 'item', itemId: 'timber', quantity: 2 });
    picks = stepItem(stepItem(stepItem(picks, 'timber', -1, 2), 'timber', -1, 2), 'timber', -1, 2);
    expect(picks[1]).toEqual({ kind: 'item', itemId: 'timber', quantity: 1 });
    // Tapping again takes it off, whatever the count.
    expect(togglePick(picks, timber(5))).toEqual([{ kind: 'squishy', squishyId: ID(1) }]);
    expect(lineKey(timber(1))).toBe(lineKey({ kind: 'item', itemId: 'timber', quantity: 4 }));
  });

  it('says why "Send" waits, and builds the request (a gift asks for nothing)', () => {
    const one = [{ kind: 'squishy' as const, squishyId: ID(1) }];
    expect(sendProblem('trade', [], [])).toBe(TRADE_TEXT.pickBoth);
    expect(sendProblem('trade', one, [])).toBe(TRADE_TEXT.pickBoth);
    expect(sendProblem('gift', [], [])).toBe(TRADE_TEXT.pickOne);
    expect(sendProblem('gift', one, [])).toBeNull();
    const lots = Array.from({ length: TRADE_RULES.linesPerSide + 1 }, (_, i) => ({
      kind: 'squishy' as const,
      squishyId: ID(i),
    }));
    expect(sendProblem('gift', lots, [])).toBe(TRADE_TEXT.tooMany);
    const pets = lots.slice(0, TRADE_RULES.squishiesPerSide + 1);
    expect(sendProblem('gift', pets, [])).toBe(TRADE_TEXT.tooManySquishies);
    const want = [{ kind: 'item' as const, itemId: 'stone', quantity: 1 }];
    expect(offerRequest({ q: 2, r: -1 }, 'gift', SAM, one, want, 'heart')).toEqual({
      q: 2,
      r: -1,
      kind: 'gift',
      toUserId: SAM,
      give: one,
      want: [],
      noteId: 'heart',
    });
    expect(offerRequest({ q: 2, r: -1 }, 'trade', SAM, one, want, null).want).toEqual(want);
  });

  it('notes are quick messages, never typed text', () => {
    expect(noteText('want-to-trade')).toBe('Want to trade?');
    expect(noteText('heart')).toBe('💖');
    expect(noteText('not-a-note')).toBeNull();
    expect(noteText(null)).toBeNull();
    for (const id of NOTE_IDS) expect(noteText(id)).not.toBeNull();
  });

  it('sorts offers, mailbox and badges for me', () => {
    const v = view({
      offers: [
        offer({}),
        offer({ id: ID(51), fromUserId: ME, toUserId: KAI }),
        offer({ id: ID(52), kind: 'gift', fromUserId: ME, toUserId: SAM, want: [] }),
        offer({ id: ID(53), status: 'accepted' }),
      ],
      mailbox: [
        mail({}),
        mail({ id: ID(71), kind: 'trade' }),
        mail({ id: ID(72), pickedUpAt: '2026-11-04T17:00:00.000Z' }),
      ],
    });
    expect(offersToMe(v, ME).map((o) => o.id)).toEqual([ID(50)]);
    expect(offersFromMe(v, ME, 'trade').map((o) => o.id)).toEqual([ID(51)]);
    expect(offersFromMe(v, ME, 'gift').map((o) => o.id)).toEqual([ID(52)]);
    expect(waiting(v).map((m) => m.id)).toEqual([ID(70), ID(71)]);
    expect(tabBadges(v, ME)).toEqual({ trade: 1, gift: 0, mailbox: 2 });
    expect(tabBadges(null, ME)).toEqual({ trade: 0, gift: 0, mailbox: 0 });
    const names = (id: string) => (id === SAM ? 'StarSam' : 'Someone');
    expect(mailboxTitle(mail({}), names)).toBe('A gift from StarSam!');
    expect(mailboxTitle(mail({ kind: 'trade' }), names)).toBe('Your trade with StarSam is done!');
  });

  it('counts a visit pass down, and says when it’s over', () => {
    const start = Date.parse('2026-11-04T16:00:00Z');
    expect(postChip(null, start)).toBe('🔗 Connected');
    expect(postChip('2026-11-04T16:18:00Z', start)).toBe('⏳ Open 18 min');
    expect(postChip('2026-11-04T16:00:20Z', start)).toBe('⏳ Open 1 min');
    expect(postChip('2026-11-04T15:59:00Z', start)).toBeNull();
  });

  it('hears only trade events about me', () => {
    const ev = (type: string, data: Record<string, unknown>) =>
      ({ v: 1, type, mapId: ID(1), seq: 1, at: '2026-11-04T16:00:00Z', data }) as WsEventMessage;
    expect(tradeEventForMe(ev('trade.offered', { fromUserId: SAM, toUserId: ME }), ME)).toBe(true);
    expect(tradeEventForMe(ev('trade.answered', { fromUserId: SAM, toUserId: KAI }), ME)).toBe(
      false,
    );
    expect(tradeEventForMe(ev('mailbox.collected', { userId: ME }), ME)).toBe(true);
    expect(tradeEventForMe(ev('chat.said', { userId: ME }), ME)).toBe(false);
  });

  it('shrinks a long name to fit its box whole, never splitting a word (owner, #271)', () => {
    // Fits already: as is.
    expect(fitName(60, 80, 13)).toEqual({ px: 13, ellipsis: false });
    // "Pebblesnooze" is 100px wide at 13px in a 76px cell: 9.5px (half-pixel steps) fits.
    const fit = fitName(100, 76, 13, 9);
    expect(fit).toEqual({ px: 9.5, ellipsis: false });
    expect((100 * fit.px) / 13).toBeLessThanOrEqual(76);
    // Too long even at the smallest size: the smallest size, on one line with "…".
    expect(fitName(300, 76, 13)).toEqual({ px: 10, ellipsis: true });
    // Nothing measured yet (a hidden sheet): leave it.
    expect(fitName(100, 0, 13)).toEqual({ px: 13, ellipsis: false });
  });

  it('keeps every line kid-safe', () => {
    const words = Object.values(TRADE_TEXT)
      .map((v) => (typeof v === 'function' ? v('StarSam' as never) : v))
      .map((v) => (typeof v === 'string' ? v : Object.values(v).join(' ')))
      .join(' ');
    expect(findAvoidedWords(words)).toEqual([]);
  });
});

describe('shelfLines (#305)', () => {
  const emberbun = (n: number, level = 6): SquishyView => ({ ...squishy(n, 'emberbun'), level });
  const shelf: TradeShelf = {
    userId: SAM,
    squishies: [emberbun(2, 3), { ...emberbun(5, 30), nickname: 'Zippy' }, squishy(3, null)],
    items: [
      { kind: 'item', itemId: 'timber', quantity: 9 },
      { kind: 'item', itemId: 'heart-charm', quantity: 1 },
    ],
    clothing: [hat],
  };
  const names = (lines: TradeLineView[]) => lines.map((l) => lineLook(l).name);

  it('filters to one kind, or shows everything', () => {
    expect(shelfLines(shelf, 'squishies', 'name').map((l) => l.kind)).toEqual([
      'squishy',
      'squishy',
      'squishy',
    ]);
    expect(names(shelfLines(shelf, 'items', 'name'))).toEqual(['Heart Charm ×1', 'Timber ×9']);
    expect(shelfLines(shelf, 'clothing', 'name')).toEqual([hat]);
    expect(shelfLines(shelf, 'all', 'name')).toHaveLength(6);
  });

  it('sorts A–Z by the name shown', () => {
    expect(names(shelfLines(shelf, 'squishies', 'name'))).toEqual([
      'Emberbun',
      'Mystery squishy',
      'Zippy',
    ]);
  });

  it('sorts rarest first by what one of each is worth, so a big stack doesn’t win', () => {
    expect(names(shelfLines(shelf, 'squishies', 'rarity'))[0]).toBe('Zippy');
    // One Heart Charm is worth more than one Timber, however many Timber there are.
    expect(names(shelfLines(shelf, 'items', 'rarity'))).toEqual(['Heart Charm ×1', 'Timber ×9']);
  });

  it('sorts newest first by the time-ordered id, with items (no date) last', () => {
    const sorted = shelfLines(shelf, 'all', 'newest');
    expect(sorted.slice(0, 4)).toEqual([
      hat,
      shelf.squishies[1],
      shelf.squishies[2],
      shelf.squishies[0],
    ]);
    expect(sorted.slice(4).map((l) => l.kind)).toEqual(['item', 'item']);
  });

  it('never changes the shelf itself', () => {
    const before = JSON.stringify(shelf);
    for (const f of SHELF_FILTERS) for (const s of SHELF_SORTS) shelfLines(shelf, f, s);
    expect(JSON.stringify(shelf)).toBe(before);
  });
});

describe('pickedViews (#305)', () => {
  it('draws picks as the shelf has them, with the picked count for items', () => {
    const shelf: TradeShelf = {
      userId: ME,
      squishies: [squishy(1)],
      items: [timber(9)],
      clothing: [],
    };
    expect(
      pickedViews(
        [
          { kind: 'item', itemId: 'timber', quantity: 2 },
          { kind: 'squishy', squishyId: ID(1) },
          { kind: 'squishy', squishyId: ID(7) },
        ],
        shelf,
      ),
    ).toEqual([timber(2), squishy(1)]);
    expect(pickedViews([{ kind: 'squishy', squishyId: ID(1) }], undefined)).toEqual([]);
  });
});

describe('meterLook (#305)', () => {
  const charm = (quantity: number): TradeLineView => ({
    kind: 'item',
    itemId: 'heart-charm',
    quantity,
  });

  it('waits for both sides, with no heart on the track', () => {
    const look = meterLook([charm(1)], [], 'Sam', 'sender');
    expect(look).toMatchObject({
      tip: 'none',
      marker: null,
      label: 'Pick something on each side!',
    });
    expect(look.giveHearts).toBeGreaterThan(0);
    expect(look.getHearts).toBe(0);
  });

  it('calls an even trade fair, with the heart in the middle band', () => {
    const look = meterLook([charm(2)], [charm(2)], 'Sam', 'sender');
    expect(look).toMatchObject({
      tip: 'even',
      lopsided: false,
      label: 'Fair trade! 💛',
      sub: null,
    });
    expect(look.marker).toBe(50);
    expect(look.giveHearts).toBe(look.getHearts);
  });

  it('tips toward whoever gets more, and the heart slides to their end', () => {
    const mine = meterLook([charm(4)], [charm(5)], 'Sam', 'sender');
    expect(mine).toMatchObject({ tip: 'me', label: 'Tips toward you', nudge: null });
    expect(mine.marker!).toBeLessThan(50 - mine.fairHalf);
    const theirs = meterLook([charm(5)], [charm(4)], 'Sam', 'sender');
    expect(theirs).toMatchObject({ tip: 'them', label: 'Tips toward Sam' });
    expect(theirs.marker!).toBeGreaterThan(50 + theirs.fairHalf);
  });

  it('nudges the sender kindly on a lopsided offer, never blocking', () => {
    expect(meterLook([charm(4)], [charm(1)], 'Sam', 'sender')).toMatchObject({
      tip: 'them',
      lopsided: true,
      label: 'Way more for Sam',
      sub: 'Want to ask for more?',
      nudge: 'ask',
    });
    expect(meterLook([charm(1)], [charm(4)], 'Sam', 'sender')).toMatchObject({
      tip: 'me',
      label: 'Way more for you',
      sub: 'Add something for Sam?',
      nudge: 'add',
    });
  });

  it('gives the receiver a calm note and no button', () => {
    expect(meterLook([charm(4)], [charm(1)], 'Lee', 'receiver')).toMatchObject({
      sub: 'That’s kind! Just check you’re happy.',
      nudge: null,
    });
    expect(meterLook([charm(1)], [charm(4)], 'Lee', 'receiver')).toMatchObject({
      sub: 'What a kind offer!',
      nudge: null,
    });
  });

  it('values a squishy the viewer hasn’t met at the plain middle value', () => {
    const mystery = meterLook([squishy(1, null)], [squishy(2, null)], 'Sam', 'sender');
    expect(mystery.tip).toBe('even');
    expect(mystery.giveHearts).toBeGreaterThan(0);
  });

  it('never shows a number, and uses kind words', () => {
    const looks = [
      meterLook([charm(4)], [charm(1)], 'Sam', 'sender'),
      meterLook([charm(1)], [charm(4)], 'Sam', 'sender'),
      meterLook([charm(4)], [charm(1)], 'Sam', 'receiver'),
      meterLook([charm(2)], [charm(2)], 'Sam', 'sender'),
    ];
    for (const look of looks) {
      const words = `${look.label} ${look.sub ?? ''}`;
      expect(words).not.toMatch(/\d/);
      expect(findAvoidedWords(words)).toEqual([]);
    }
  });
});
