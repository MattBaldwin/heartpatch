import { describe, expect, it } from 'vitest';
import { COMPUTER_MATES } from '../data/server/computer-mates.js';
import { hexDistance, hexKey, hexSpiral, type Hex } from '../hex/index.js';
import { deriveSeed, Rng } from '../rng/index.js';
import { TRADING_POST_TERRAIN } from '../territory/reach.js';
import { TRADE_VALUES } from '../data/trading.js';
import {
  challengeTarget,
  claimTarget,
  inQuietHours,
  mayChallenge,
  type MateChallengeView,
  insideFairBand,
  mateGift,
  mateItems,
  mateOffer,
  mateSaysYes,
  offerToAnswer,
  type MateIncomingOffer,
  type MateTradingView,
  mateLandCap,
  mateTeamLevel,
  nextIntent,
  type MateView,
  type MateViewTile,
} from './policy.js';

const rules = COMPUTER_MATES.rules;
const persona = COMPUTER_MATES.personas[0]!;
const MATE = 'mate';
const KID = 'kid';
const KID_SEED: Hex = { q: 0, r: 0 };
const MATE_SEED: Hex = { q: 8, r: 0 };

/** A radius-10 patch: the kid's home at the middle, the mate's 8 tiles east. */
function patch(extra: (t: MateViewTile) => Partial<MateViewTile> = () => ({})): MateViewTile[] {
  return hexSpiral({ q: 0, r: 0 }, 10).map((h) => {
    const base: MateViewTile = {
      q: h.q,
      r: h.r,
      terrain: 'meadow',
      ownerUserId: null,
      homeSlot: null,
    };
    if (hexDistance(h, KID_SEED) <= 1) return { ...base, ownerUserId: KID, homeSlot: 0 };
    if (hexDistance(h, MATE_SEED) <= 1) return { ...base, ownerUserId: MATE, homeSlot: 1 };
    return { ...base, ...extra(base) };
  });
}

const view = (tiles: MateViewTile[], over: Partial<MateView> = {}): MateView => ({
  userId: MATE,
  tiles,
  kids: [{ userId: KID, heartSeed: KID_SEED }],
  seats: 2,
  claimsToday: 0,
  catchUp: false,
  fires: [],
  built: [],
  guarded: [],
  freeSquishies: 3,
  contested: [],
  ...over,
});

const rngAt = (step: number) => Rng.fromSeed(deriveSeed('mate-seed', step));

describe('computer mates policy', () => {
  it('nextIntent is deterministic for a seed and step', () => {
    const v = view(patch());
    for (let step = 0; step < 20; step++) {
      expect(nextIntent(v, persona, rules, rngAt(step))).toEqual(
        nextIntent(v, persona, rules, rngAt(step)),
      );
    }
  });

  it('claims next to its land, toward the kid, never inside the kid buffer', () => {
    const target = claimTarget(view(patch()), rules);
    expect(target).not.toBeNull();
    expect(hexDistance(target!, MATE_SEED)).toBe(2);
    expect(hexDistance(target!, KID_SEED)).toBeGreaterThan(rules.kidHomeBuffer);
    // Leaning toward the kid: the westmost ring-2 tile around its home.
    expect(target!.q).toBeLessThan(MATE_SEED.q);
  });

  it('never claims a tile a kid is battling for', () => {
    const first = claimTarget(view(patch()), rules)!;
    const next = claimTarget(view(patch(), { contested: [first] }), rules);
    expect(next).not.toBeNull();
    expect(hexKey(next!)).not.toBe(hexKey(first));
  });

  it('never claims a post, water or grey village tile', () => {
    const banned = (t: MateViewTile): Partial<MateViewTile> =>
      hexDistance(t, MATE_SEED) === 2
        ? t.q % 3 === 0
          ? { terrain: TRADING_POST_TERRAIN }
          : t.q % 3 === 1
            ? { terrain: 'wild-lake' }
            : { communityId: 'v1' }
        : {};
    expect(claimTarget(view(patch(banned)), rules)).toBeNull();
  });

  it('never claims within the kid buffer even when that is all that is left', () => {
    // The mate's home right next to the kid's buffer, everything else taken.
    const tiles = patch((t) =>
      hexDistance(t, KID_SEED) > rules.kidHomeBuffer ? { ownerUserId: 'someone' } : {},
    );
    const near = tiles.map((t) =>
      hexDistance(t, { q: 3, r: 0 }) === 0 ? { ...t, ownerUserId: MATE } : t,
    );
    const target = claimTarget(view(near), rules);
    expect(target).toBeNull();
  });

  it('stops claiming at the land cap', () => {
    const tiles = patch();
    const cap = mateLandCap(tiles, 2, rules);
    // Give the mate exactly `cap` outer tiles, nearest its home first.
    const outer = tiles
      .filter((t) => t.homeSlot === null && hexDistance(t, KID_SEED) > 3)
      .sort((a, b) => hexDistance(a, MATE_SEED) - hexDistance(b, MATE_SEED))
      .slice(0, cap)
      .map(hexKey);
    const owned = new Set(outer);
    const full = tiles.map((t) => (owned.has(hexKey(t)) ? { ...t, ownerUserId: MATE } : t));
    const fires = full.filter((t) => owned.has(hexKey(t))).slice(0, Math.floor(cap / 6));
    for (let step = 0; step < 30; step++) {
      const intent = nextIntent(
        view(full, { fires, freeSquishies: 0 }),
        persona,
        rules,
        rngAt(step),
      );
      expect(intent?.kind).not.toBe('claim');
    }
  });

  it('respects claimsPerDay', () => {
    const v = view(patch(), { claimsToday: persona.claimsPerDay, freeSquishies: 0 });
    expect(nextIntent(v, persona, rules, rngAt(1))).toBeNull();
  });

  it('lights one fire per fireEveryTiles, on its darkest empty tile', () => {
    const tiles = patch();
    const outer = tiles
      .filter((t) => hexDistance(t, MATE_SEED) === 2)
      .slice(0, rules.fireEveryTiles)
      .map(hexKey);
    const owned = new Set(outer);
    const mine = tiles.map((t) => (owned.has(hexKey(t)) ? { ...t, ownerUserId: MATE } : t));
    const intent = nextIntent(view(mine), persona, rules, rngAt(0));
    expect(intent?.kind).toBe('fire');
    expect(owned.has(hexKey(intent as Hex))).toBe(true);
    // One fire is enough for six tiles.
    const lit = nextIntent(view(mine, { fires: [intent as Hex] }), persona, rules, rngAt(0));
    expect(lit?.kind).not.toBe('fire');
  });

  it('guards only border tiles that face a kid, up to guardedTiles', () => {
    // Mate land running west to touch the kid's land.
    const tiles = patch().map((t) =>
      t.r === 0 && t.q >= 2 && t.q <= 6 ? { ...t, ownerUserId: MATE } : t,
    );
    const guardOnly = { ...persona, weights: { ...persona.weights, claim: 0 } };
    const intent = nextIntent(view(tiles, { fires: [{ q: 4, r: 0 }] }), guardOnly, rules, rngAt(0));
    expect(intent).toEqual({ kind: 'guard', q: 2, r: 0 });
    const full = view(tiles, {
      fires: [{ q: 4, r: 0 }],
      guarded: [
        { q: 2, r: 0 },
        { q: 9, r: 9 },
      ],
    });
    expect(nextIntent(full, guardOnly, rules, rngAt(0))).toBeNull();
  });

  it('a catch-up step only claims', () => {
    const tiles = patch();
    const outer = new Set(
      tiles
        .filter((t) => hexDistance(t, MATE_SEED) === 2)
        .slice(0, 7)
        .map(hexKey),
    );
    const mine = tiles.map((t) => (outer.has(hexKey(t)) ? { ...t, ownerUserId: MATE } : t));
    for (let step = 0; step < 20; step++) {
      const intent = nextIntent(view(mine, { catchUp: true }), persona, rules, rngAt(step));
      expect(intent === null || intent.kind === 'claim').toBe(true);
    }
  });

  it("a mate's levels track the kid's Partner inside the offset", () => {
    for (const p of COMPUTER_MATES.personas) {
      for (const partner of [1, 5, 30, 60]) {
        const level = mateTeamLevel(partner, p);
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(partner);
        if (partner > 3) expect(partner - level).toBe(-p.levelOffset);
      }
    }
  });

  describe('trades and gifts (386d)', () => {
    const trading = (over: Partial<MateTradingView> = {}): MateTradingView => ({
      enabled: true,
      incoming: [],
      completedToday: 0,
      giftsThisWeek: 0,
      offersThisWeek: 0,
      kids: [{ userId: KID, bag: { timber: 20, stone: 12, glimmer: 3 } }],
      ...over,
    });
    const offer = (over: Partial<MateIncomingOffer> = {}): MateIncomingOffer => ({
      id: 'o1',
      kind: 'trade',
      waitedMinutes: 60,
      giveValue: 30,
      wantValue: 30,
      wantsItemsOnly: true,
      wantItemIds: ['timber'],
      ...over,
    });
    /** Trade- and gift-only mates: no claims or guards to pick instead. */
    const trader = { ...persona, weights: { ...persona.weights, claim: 0, guard: 0 } };
    const tradeOnly = { ...trader, weights: { ...trader.weights, gift: 0 } };
    const giftOnly = { ...trader, weights: { ...trader.weights, trade: 0 } };
    const quiet = (t: MateTradingView) =>
      view(patch(), { trading: t, freeSquishies: 0, fires: [] });
    const items = (lines: readonly { itemId: string; quantity: number }[]) =>
      lines.reduce((sum, l) => sum + (TRADE_VALUES.items[l.itemId] ?? 0) * l.quantity, 0);

    it('a computer mate declines an unfair offer and accepts a fair one after its delay', () => {
      const fair = offer({ giveValue: 27, wantValue: 30 }); // 90 %
      const unfair = offer({ giveValue: 22, wantValue: 30 }); // 73 %
      expect(mateSaysYes(fair, rules)).toBe(true);
      expect(mateSaysYes(unfair, rules)).toBe(false);
      // Asking for a squishy or clothing, or a lopsided gift of a trade: no thanks.
      expect(mateSaysYes(offer({ wantsItemsOnly: false }), rules)).toBe(false);
      expect(mateSaysYes(offer({ giveValue: 61, wantValue: 30 }), rules)).toBe(false);
      expect(mateSaysYes(offer({ kind: 'gift', wantValue: 0 }), rules)).toBe(true);
      // Not before answerMinutes.
      const early = { waitedMinutes: persona.answerMinutes - 1 };
      expect(offerToAnswer(trading({ incoming: [{ ...fair, ...early }] }), persona, rules)).toBe(
        null,
      );
      expect(offerToAnswer(trading({ incoming: [fair] }), persona, rules)).toEqual({
        kind: 'answer-offer',
        offerId: 'o1',
        answer: 'accept',
      });
      expect(offerToAnswer(trading({ incoming: [unfair] }), persona, rules)?.answer).toBe(
        'decline',
      );
      // The answer comes before anything else the persona might pick.
      expect(nextIntent(quiet(trading({ incoming: [fair] })), persona, rules, rngAt(1))).toEqual(
        expect.objectContaining({ kind: 'answer-offer' }),
      );
    });

    it('a computer mate declines asking for anything off mateItems, or worth more than offerValue.max', () => {
      expect(mateItems(rules)).toEqual([...rules.mateItems].sort());
      for (const id of ['heartdust', 'glimmer', 'heart-charm', 'jack-o-lantern-hearthfire']) {
        expect(mateItems(rules)).not.toContain(id);
        expect(mateSaysYes(offer({ wantItemIds: ['timber', id] }), rules), id).toBe(false);
      }
      const max = rules.offerValue.max;
      expect(mateSaysYes(offer({ giveValue: max, wantValue: max }), rules)).toBe(true);
      expect(mateSaysYes(offer({ giveValue: max + 1, wantValue: max + 1 }), rules)).toBe(false);
    });

    it('a yes waits while completedPerPatchDay is used up; a no never waits', () => {
      const full = { completedToday: rules.completedPerPatchDay };
      expect(offerToAnswer(trading({ ...full, incoming: [offer()] }), persona, rules)).toBe(null);
      expect(
        offerToAnswer(trading({ ...full, incoming: [offer({ kind: 'gift' })] }), persona, rules),
      ).toBe(null);
      expect(
        offerToAnswer(trading({ ...full, incoming: [offer({ giveValue: 1 })] }), persona, rules)
          ?.answer,
      ).toBe('decline');
      // And no new offers or gifts that day.
      for (let step = 0; step < 30; step++) {
        expect(nextIntent(quiet(trading(full)), trader, rules, rngAt(step))).toBe(null);
      }
    });

    it('a computer offer is always inside the fair band, items only, asking for what the kid has', () => {
      for (let step = 0; step < 200; step++) {
        const made = mateOffer(trading(), rules, rngAt(step));
        expect(made).not.toBeNull();
        const { give, want, toUserId, noteId } = made!;
        expect(toUserId).toBe(KID);
        expect(noteId).toBe('want-to-trade');
        expect(insideFairBand(items(give), items(want), rules)).toBe(true);
        expect(items(give)).toBeLessThanOrEqual(rules.offerValue.max);
        for (const line of [...give, ...want]) expect(rules.mateItems).toContain(line.itemId);
        for (const w of want) {
          expect(w.quantity).toBeLessThanOrEqual(trading().kids[0]!.bag[w.itemId] ?? 0);
        }
        expect(give.every((g) => !want.some((w) => w.itemId === g.itemId))).toBe(true);
      }
      // A kid with nothing tradable gets no offer.
      expect(mateOffer(trading({ kids: [{ userId: KID, bag: {} }] }), rules, rngAt(1))).toBe(null);
    });

    it('offersPerWeek is per mate; giftsPerPatchWeek counts all mates', () => {
      const used = trading({ offersThisWeek: tradeOnly.offersPerWeek });
      const gifted = trading({ giftsThisWeek: rules.giftsPerPatchWeek });
      for (let step = 0; step < 30; step++) {
        expect(nextIntent(quiet(used), tradeOnly, rules, rngAt(step))).toBe(null);
        expect(nextIntent(quiet(gifted), giftOnly, rules, rngAt(step))).toBe(null);
        expect(nextIntent(quiet(trading()), tradeOnly, rules, rngAt(step))?.kind).toBe('offer');
        expect(nextIntent(quiet(trading()), giftOnly, rules, rngAt(step))?.kind).toBe('gift');
      }
    });

    it('every gift is worth at most giftMaxValue', () => {
      for (let step = 0; step < 200; step++) {
        const gift = mateGift(trading(), rules, rngAt(step))!;
        expect(items(gift.give)).toBeGreaterThan(0);
        expect(items(gift.give)).toBeLessThanOrEqual(rules.giftMaxValue);
        for (const line of gift.give) expect(rules.mateItems).toContain(line.itemId);
        expect(gift.noteId).toBe('heart');
      }
    });

    it('never trades while catching up, with trading off, or with no kid to send to', () => {
      const v = quiet(trading({ incoming: [offer()] }));
      for (let step = 0; step < 30; step++) {
        expect(nextIntent({ ...v, catchUp: true }, trader, rules, rngAt(step))).toBe(null);
        expect(
          nextIntent(
            quiet(trading({ enabled: false, incoming: [offer()] })),
            trader,
            rules,
            rngAt(step),
          ),
        ).toBe(null);
        expect(nextIntent(quiet(trading({ kids: [] })), trader, rules, rngAt(step))).toBe(null);
      }
    });
  });

  describe("challenges on a kid's tile (386e)", () => {
    const challenger = {
      ...persona,
      weights: { claim: 0, trade: 0, gift: 0, guard: 0, challenge: 1 },
    };
    /** The kid holds everything 2–6 from their seed on the mate's side (q >= 2). */
    const kidLand = () =>
      patch((t) => {
        const d = hexDistance(t, KID_SEED);
        return d >= 2 && d <= 6 && t.q >= 2 ? { ownerUserId: KID } : {};
      });
    const open: MateChallengeView = {
      pvpMode: 'gentle',
      thisWeek: 0,
      localHour: 12,
      busy: false,
      shielded: [],
      online: [KID],
      fenced: [],
    };
    const challengeView = (
      tiles: MateViewTile[],
      c: Partial<MateChallengeView> = {},
      over: Partial<MateView> = {},
    ) => view(tiles, { challenge: { ...open, ...c }, ...over });
    const intents = (v: MateView) =>
      Array.from({ length: 20 }, (_, step) => nextIntent(v, challenger, rules, rngAt(step)));

    it("challenges a kid's border tile next to its land, outside the home buffer and never-fade ring", () => {
      const v = challengeView(kidLand());
      for (const intent of intents(v)) {
        expect(intent?.kind).toBe('challenge');
        if (intent?.kind !== 'challenge') continue;
        const tile = v.tiles.find((t) => t.q === intent.q && t.r === intent.r)!;
        expect(tile.ownerUserId).toBe(KID);
        expect(tile.homeSlot).toBeNull();
        expect(hexDistance(tile, KID_SEED)).toBeGreaterThan(Math.max(rules.kidHomeBuffer, 2));
        expect(hexDistance(tile, MATE_SEED)).toBe(2);
      }
    });

    it('catch-up never challenges', () => {
      const v = challengeView(kidLand(), {}, { catchUp: true });
      expect(mayChallenge(v, rules)).toBe(false);
      expect(intents(v).some((i) => i?.kind === 'challenge')).toBe(false);
    });

    it('is refused in Off, in quiet hours, while busy, past the weekly cap, for a shielded kid, at the land cap and under minKidTiles', () => {
      const tiles = kidLand();
      const refused: MateView[] = [
        challengeView(tiles, { pvpMode: 'off' }),
        challengeView(tiles, { localHour: rules.quietHours.from }),
        challengeView(tiles, { localHour: 2 }),
        challengeView(tiles, { busy: true }),
        challengeView(tiles, { thisWeek: rules.challengesPerPatchWeek.gentle }),
        challengeView(tiles, { pvpMode: 'on', thisWeek: rules.challengesPerPatchWeek.on }),
        challengeView(tiles, { shielded: [KID] }),
        // At its land cap (a share of 0 here): a won challenge would pass it.
        challengeView(tiles, {}, { seats: 10_000 }),
        view(tiles),
      ];
      for (const v of refused) {
        expect(intents(v).some((i) => i?.kind === 'challenge')).toBe(false);
      }
      // Fewer than minKidTiles outside home: never.
      const few = patch((t) =>
        hexDistance(t, MATE_SEED) === 2 && t.q === 6 ? { ownerUserId: KID } : {},
      );
      expect(few.filter((t) => t.ownerUserId === KID && t.homeSlot === null).length).toBeLessThan(
        rules.minKidTiles,
      );
      expect(challengeTarget(challengeView(few), rules)).toBeNull();
    });

    it('challenges only a kid who has the patch open right now, never one away (#823 ruling)', () => {
      const tiles = kidLand();
      expect(challengeTarget(challengeView(tiles), rules)).not.toBeNull();
      // Warm because another kid looked, but this kid is away: never.
      const away = challengeView(tiles, { online: ['another-kid'] });
      expect(challengeTarget(away, rules)).toBeNull();
      expect(intents(away).some((i) => i?.kind === 'challenge')).toBe(false);
      expect(challengeTarget(challengeView(tiles, { online: [] }), rules)).toBeNull();
    });

    it('never challenges a fenced tile: fences hold computer friends off (#823 ruling)', () => {
      const tiles = kidLand();
      const first = challengeTarget(challengeView(tiles), rules)!;
      const next = challengeTarget(challengeView(tiles, { fenced: [first] }), rules);
      expect(next).not.toEqual(first);
      // Every border tile fenced: nothing to challenge.
      const border = tiles.filter((t) => t.ownerUserId === KID && t.homeSlot === null);
      expect(challengeTarget(challengeView(tiles, { fenced: border }), rules)).toBeNull();
    });

    it('never challenges a tile someone is already battling for', () => {
      const tiles = kidLand();
      const first = challengeTarget(challengeView(tiles), rules)!;
      const next = challengeTarget(challengeView(tiles, {}, { contested: [first] }), rules);
      expect(next).not.toEqual(first);
    });

    it('quiet hours wrap past midnight', () => {
      const quiet = { quietHours: { from: 21, to: 7 } };
      expect([21, 23, 0, 6].every((h) => inQuietHours(h, quiet))).toBe(true);
      expect([7, 12, 20].some((h) => inQuietHours(h, quiet))).toBe(false);
      expect(inQuietHours(3, { quietHours: { from: 1, to: 5 } })).toBe(true);
      expect(inQuietHours(3, { quietHours: { from: 4, to: 4 } })).toBe(false);
    });
  });
});
