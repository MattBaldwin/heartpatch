import { GAME_DATA } from '../data/index.js';
import { TRADE_VALUES } from '../data/trading.js';
import { hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import type { Rng } from '../rng/index.js';
import { TERRITORY_RULES } from '../data/territory.js';
import type { PvpMode } from '../schemas/maps.js';
import type { ComputerMateRules, ComputerPersonaTuning } from '../schemas/data/computer-mates.js';
import { isTradableResource } from '../schemas/data/resources.js';
import type { TradeValues } from '../schemas/data/trading.js';
import { isTradingPost, isWaterTerrain } from '../territory/reach.js';
import { attackTargetProblem, type TerritoryTile } from '../territory/index.js';

/*
 * What a computer patch-mate does next (#386c, plan §1 C–E). One pure,
 * seeded function: the server builds a plain view of the patch, calls
 * `nextIntent` with `Rng.fromSeed(deriveSeed(mate.seed, step))`, and applies
 * the one intent it returns through the module that owns it. The map-fill
 * sim calls the same function, so the sim and the server can't drift.
 *
 * Tending, fuelling their fires and setting their team's levels aren't
 * intents: every step does them (see the server's `act`).
 */

/** A tile as the policy sees it (`PublicTile` and the sim's tiles fit). */
export interface MateViewTile extends TerritoryTile {
  readonly terrain: string;
}

export interface MateView {
  /** The mate's user id. */
  readonly userId: string;
  /** Every tile on the patch. */
  readonly tiles: readonly MateViewTile[];
  /** Real kids' user ids on the patch, and their Heart Seeds. */
  readonly kids: readonly { readonly userId: string; readonly heartSeed: Hex }[];
  /** The patch's seats (`maps.max_players`): a fair share is claimable tiles ÷ seats. */
  readonly seats: number;
  /** Claims the mate made this patch day. */
  readonly claimsToday: number;
  /** A catch-up step (a kid just came back): claims and tending only. */
  readonly catchUp: boolean;
  /** Tiles that hold one of the mate's Hearthfires. */
  readonly fires: readonly Hex[];
  /** Tiles that hold any building (a fire needs an empty tile). */
  readonly built: readonly Hex[];
  /** Tiles where the mate has a squishy on watch. */
  readonly guarded: readonly Hex[];
  /** The mate's squishies not on watch (a guard needs one). */
  readonly freeSquishies: number;
  /** Tiles someone is battling for right now (an open `tile_attacks` row): never claimed. */
  readonly contested: readonly Hex[];
  /** Trades and gifts (386d); absent (the map-fill sim) means none. */
  readonly trading?: MateTradingView;
  /** Challenging a kid's tile (386e); absent means never. */
  readonly challenge?: MateChallengeView;
}

/**
 * What a mate's tile challenge reads (386e, plan §1 D "Challenge a kid's
 * tile"). The server checks every one of these again under its locks.
 */
export interface MateChallengeView {
  /** The patch's PvP mode: Off never challenges. */
  readonly pvpMode: PvpMode;
  /** Challenges every mate made on this patch in the last 7 days. */
  readonly thisWeek: number;
  /** The patch's local hour (0–23): never in quiet hours. */
  readonly localHour: number;
  /** The mate is in a battle already (one at a time). */
  readonly busy: boolean;
  /** Kids still inside their new-player shield. */
  readonly shielded: readonly string[];
  /**
   * Kids with the patch open right now (`isOnline`, coordinator ruling on
   * #823): a mate challenges only a kid who can see it happen, never one
   * who is away or asleep, even on a patch kept warm by another kid.
   */
  readonly online: readonly string[];
  /** Kids' tiles fenced all round (#203): fences hold computer friends off. */
  readonly fenced: readonly Hex[];
}

/** A kid's open offer or gift to the mate, valued by `TRADE_VALUES` (the server knows every species). */
export interface MateIncomingOffer {
  readonly id: string;
  readonly kind: 'trade' | 'gift';
  /** Minutes since the kid sent it. */
  readonly waitedMinutes: number;
  /** The kid's side. */
  readonly giveValue: number;
  /** What the kid asks of the mate. */
  readonly wantValue: number;
  /** The kid asks for items only (a mate never gives a squishy or clothing). */
  readonly wantsItemsOnly: boolean;
  /** The item ids the kid asks for: a mate gives only what's on `mateItems`. */
  readonly wantItemIds: readonly string[];
}

/** What a mate's trade and gift choices read (386d). Caps count across all mates unless noted. */
export interface MateTradingView {
  /** The owner's trading switch. */
  readonly enabled: boolean;
  /** Open offers and gifts to this mate, oldest first. */
  readonly incoming: readonly MateIncomingOffer[];
  /** Trades and gifts with a mate finished this patch day, all mates. */
  readonly completedToday: number;
  /** Gifts mates sent in the last 7 days, all mates. */
  readonly giftsThisWeek: number;
  /** Offers this mate sent in the last 7 days. */
  readonly offersThisWeek: number;
  /** Kids this mate may send to now (nothing open from it to them), with their tradable items. */
  readonly kids: readonly {
    readonly userId: string;
    readonly bag: Readonly<Record<string, number>>;
  }[];
}

/** One stack of an item on one side of a mate's offer or gift. */
export interface MateItemLine {
  readonly itemId: string;
  readonly quantity: number;
}

/** The preset notes a mate's offer and gift carry: the only words a mate ever sends (plan §1 E). */
export const MATE_NOTES = { offer: 'want-to-trade', gift: 'heart' } as const;

export type MateIntent =
  | { readonly kind: 'claim'; readonly q: number; readonly r: number }
  | { readonly kind: 'fire'; readonly q: number; readonly r: number }
  | { readonly kind: 'guard'; readonly q: number; readonly r: number }
  | {
      readonly kind: 'answer-offer';
      readonly offerId: string;
      readonly answer: 'accept' | 'decline';
    }
  | {
      readonly kind: 'offer';
      readonly toUserId: string;
      readonly give: readonly MateItemLine[];
      readonly want: readonly MateItemLine[];
      readonly noteId: string;
    }
  | {
      readonly kind: 'gift';
      readonly toUserId: string;
      readonly give: readonly MateItemLine[];
      readonly noteId: string;
    }
  | { readonly kind: 'challenge'; readonly q: number; readonly r: number };

/** The intents that act on a tile. */
export type MateTileIntent = Extract<MateIntent, { q: number }>;

/** Tiles anyone could ever hold outside a home: no home ring, post, water or grey village. */
export function claimableTiles<T extends MateViewTile>(tiles: readonly T[]): T[] {
  return tiles.filter(
    (t) =>
      t.homeSlot === null &&
      !isTradingPost(t) &&
      !isWaterTerrain(t.terrain) &&
      ((t.communityId ?? null) === null || t.restored === true),
  );
}

/** The most land outside its home a mate may hold: `landCapPercent` of a fair share. */
export function mateLandCap(
  tiles: readonly MateViewTile[],
  seats: number,
  rules: ComputerMateRules,
): number {
  const fair = claimableTiles(tiles).length / Math.max(1, seats);
  return Math.floor((fair * rules.landCapPercent) / 100);
}

/** Their team's level: the kid's Partner level plus the persona's offset, at least 1. */
export function mateTeamLevel(partnerLevel: number, persona: ComputerPersonaTuning): number {
  return Math.max(1, partnerLevel + persona.levelOffset);
}

const nearest = (h: Hex, points: readonly Hex[]): number =>
  points.reduce((best, p) => Math.min(best, hexDistance(h, p)), Number.POSITIVE_INFINITY);

const byHex = (a: Hex, b: Hex) => a.q - b.q || a.r - b.r;

/** The mate's outer land (not its home ring). */
function outerLand(view: MateView): MateViewTile[] {
  return view.tiles.filter((t) => t.ownerUserId === view.userId && t.homeSlot === null);
}

/** The mate's own Heart Seed: the middle of its home ring (the tile all ring tiles touch). */
function homeOf(view: MateView): Hex | null {
  const ring = view.tiles.filter((t) => t.ownerUserId === view.userId && t.homeSlot !== null);
  if (ring.length === 0) return null;
  const keys = new Set(ring.map(hexKey));
  return (
    [...ring].sort(byHex).find((t) => hexNeighbors(t).every((n) => keys.has(hexKey(n)))) ??
    [...ring].sort(byHex)[0] ??
    null
  );
}

/**
 * The wild tile to claim next, or null: next to the mate's land, never a
 * home ring, post, water or grey village (`attackTargetProblem` with PvP
 * off, so only wild land), never a tile a kid is battling for, never within `kidHomeBuffer` of a kid's Heart
 * Seed. Nearest its own home first, leaning toward the nearest kid so
 * borders meet; ties by position.
 */
export function claimTarget(view: MateView, rules: ComputerMateRules): Hex | null {
  const home = homeOf(view);
  const seeds = view.kids.map((k) => k.heartSeed);
  const contested = new Set(view.contested.map(hexKey));
  const options = view.tiles.filter(
    (t) =>
      t.ownerUserId === null &&
      !contested.has(hexKey(t)) &&
      attackTargetProblem(t, view.tiles, view.userId, 'off') === null &&
      nearest(t, seeds) > rules.kidHomeBuffer,
  );
  const score = (t: Hex) =>
    (home ? hexDistance(t, home) * 2 : 0) + (seeds.length > 0 ? nearest(t, seeds) : 0);
  const [best] = options.sort((a, b) => score(a) - score(b) || byHex(a, b));
  return best ? { q: best.q, r: best.r } : null;
}

/** Fires the mate's outer land should have: one per `fireEveryTiles`. */
export function firesWanted(view: MateView, rules: ComputerMateRules): number {
  return Math.floor(outerLand(view).length / rules.fireEveryTiles);
}

/** Where the next fire goes: the empty outer tile farthest from its fires (the darkest). */
export function fireSpot(view: MateView): Hex | null {
  const built = new Set(view.built.map(hexKey));
  const options = outerLand(view).filter((t) => !built.has(hexKey(t)));
  if (options.length === 0) return null;
  const fires = view.fires;
  const dark = (t: Hex) => (fires.length === 0 ? 0 : nearest(t, fires));
  const [best] = options.sort((a, b) => dark(b) - dark(a) || byHex(a, b));
  return best ? { q: best.q, r: best.r } : null;
}

/** The mate's border tiles that touch a kid's land, nearest a kid's Heart Seed first. */
export function borderFacingKids(view: MateView): Hex[] {
  const kids = new Set(view.kids.map((k) => k.userId));
  const owner = new Map<HexKey, string | null>(view.tiles.map((t) => [hexKey(t), t.ownerUserId]));
  const seeds = view.kids.map((k) => k.heartSeed);
  return outerLand(view)
    .filter((t) =>
      hexNeighbors(t).some((n) => {
        const o = owner.get(hexKey(n));
        return o !== undefined && o !== null && kids.has(o);
      }),
    )
    .sort((a, b) => nearest(a, seeds) - nearest(b, seeds) || byHex(a, b))
    .map((t) => ({ q: t.q, r: t.r }));
}

/** Whether `hour` (patch time) is inside the quiet hours (they may wrap past midnight). */
export function inQuietHours(hour: number, rules: Pick<ComputerMateRules, 'quietHours'>): boolean {
  const { from, to } = rules.quietHours;
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Challenges all mates may still make this patch week, in this PvP mode. */
export function challengesLeft(
  challenge: Pick<MateChallengeView, 'pvpMode' | 'thisWeek'>,
  rules: ComputerMateRules,
): number {
  return Math.max(0, rules.challengesPerPatchWeek[challenge.pvpMode] - challenge.thisWeek);
}

/**
 * Whether a mate may challenge right now (plan §1 C, D): never in catch-up,
 * in Off, past the weekly cap, in quiet hours, while already battling, or at
 * its land cap (a won challenge is land, like a claim: plan §9 gate d).
 */
export function mayChallenge(view: MateView, rules: ComputerMateRules): boolean {
  const c = view.challenge;
  return (
    c !== undefined &&
    !view.catchUp &&
    outerLand(view).length < mateLandCap(view.tiles, view.seats, rules) &&
    !c.busy &&
    c.pvpMode !== 'off' &&
    challengesLeft(c, rules) > 0 &&
    !inQuietHours(c.localHour, rules)
  );
}

/**
 * The kid's tile a mate challenges next, or null (plan §1 D): a border tile
 * next to the mate's land, never a home ring or never-fade ring tile (more
 * than `kidHomeBuffer` and `keepRadius` from the kid's Heart Seed), never a
 * contested tile, never a fenced tile, never a shielded kid's, only from a
 * kid who has the patch open right now, and only from a kid who holds at
 * least `minKidTiles` outside home. `attackTargetProblem` with the patch's
 * PvP mode has the last word, as for a kid. Nearest the mate's home first.
 */
export function challengeTarget(view: MateView, rules: ComputerMateRules): Hex | null {
  const c = view.challenge;
  if (!c) return null;
  const home = homeOf(view);
  const contested = new Set(view.contested.map(hexKey));
  const shielded = new Set(c.shielded);
  const online = new Set(c.online);
  const fenced = new Set(c.fenced.map(hexKey));
  const buffer = Math.max(rules.kidHomeBuffer, TERRITORY_RULES.tending.keepRadius);
  const options = view.kids.flatMap((kid) => {
    if (shielded.has(kid.userId) || !online.has(kid.userId)) return [];
    const land = view.tiles.filter((t) => t.ownerUserId === kid.userId && t.homeSlot === null);
    if (land.length < rules.minKidTiles) return [];
    return land.filter(
      (t) =>
        !contested.has(hexKey(t)) &&
        !fenced.has(hexKey(t)) &&
        hexDistance(t, kid.heartSeed) > buffer &&
        attackTargetProblem(t, view.tiles, view.userId, c.pvpMode) === null,
    );
  });
  const score = (t: Hex) => (home ? hexDistance(t, home) : 0);
  const [best] = options.sort((a, b) => score(a) - score(b) || byHex(a, b));
  return best ? { q: best.q, r: best.r } : null;
}

const TRADABLE = new Set(GAME_DATA.resources.filter(isTradableResource).map((r) => r.id));

/**
 * What a mate can make for a trade or gift: the everyday gathered resources
 * on `mateItems` (386d) that anyone may trade and that have a value, sorted.
 */
export function mateItems(rules: ComputerMateRules, values: TradeValues = TRADE_VALUES): string[] {
  return [...new Set(rules.mateItems)]
    .filter((id) => TRADABLE.has(id) && (values.items[id] ?? 0) > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether two sides are inside the fair band: the smaller is at least `minFairPercent` of the bigger. */
export function insideFairBand(a: number, b: number, rules: ComputerMateRules): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.min(a, b) * 100 >= Math.max(a, b) * rules.minFairPercent;
}

/**
 * A mate's answer to a kid's offer (plan §1 D): a gift is always welcome; a
 * trade is a yes only for items on `mateItems` (never a squishy, clothing or
 * anything rarer), worth at most `offerValue.max` from the mate, with the
 * kid's side worth at least `minFairPercent` of the mate's, and not lopsided
 * the kid's way either (a mate never takes a lopsided trade, plan §1 E).
 */
export function mateSaysYes(
  offer: MateIncomingOffer,
  rules: ComputerMateRules,
  values: TradeValues = TRADE_VALUES,
): boolean {
  if (offer.kind === 'gift') return true;
  if (!offer.wantsItemsOnly || offer.wantValue <= 0 || offer.giveValue <= 0) return false;
  const shelf = new Set(mateItems(rules, values));
  if (!offer.wantItemIds.every((id) => shelf.has(id))) return false;
  if (offer.wantValue > rules.offerValue.max) return false;
  return (
    offer.giveValue * 100 >= offer.wantValue * rules.minFairPercent &&
    offer.giveValue < values.lopsided * offer.wantValue
  );
}

const itemsValue = (lines: readonly MateItemLine[], values: TradeValues) =>
  lines.reduce((sum, l) => sum + (values.items[l.itemId] ?? 0) * l.quantity, 0);

/**
 * A mate's own offer to a kid, or null: items on `mateItems` only, asking for
 * one stack the kid has (worth about `offerValue`), giving one stack of
 * another, always inside the fair band and never worth more than
 * `offerValue.max`.
 */
export function mateOffer(
  trading: MateTradingView,
  rules: ComputerMateRules,
  rng: Rng,
  values: TradeValues = TRADE_VALUES,
): Extract<MateIntent, { kind: 'offer' }> | null {
  const shelf = mateItems(rules, values);
  const kids = trading.kids.filter((k) => shelf.some((id) => (k.bag[id] ?? 0) > 0));
  if (kids.length === 0) return null;
  const kid = rng.pick(kids);
  const target = rng.int(rules.offerValue.min, rules.offerValue.max);
  const wantable = shelf.filter((id) => (kid.bag[id] ?? 0) > 0);
  const wantId = rng.pick(wantable);
  const each = values.items[wantId] ?? 0;
  const quantity = Math.max(1, Math.min(kid.bag[wantId] ?? 0, Math.round(target / each)));
  const want = [{ itemId: wantId, quantity }];
  const wantValue = itemsValue(want, values);
  // Every other item, from a seeded start: the first that fits the band.
  const others = shelf.filter((id) => id !== wantId);
  const start = rng.int(0, Math.max(0, others.length - 1));
  for (let i = 0; i < others.length; i++) {
    const giveId = others[(start + i) % others.length];
    if (giveId === undefined) continue;
    const per = values.items[giveId] ?? 0;
    const giveQty = Math.max(1, Math.round(wantValue / per));
    const give = [{ itemId: giveId, quantity: giveQty }];
    const giveValue = itemsValue(give, values);
    if (giveValue <= rules.offerValue.max && insideFairBand(giveValue, wantValue, rules)) {
      return { kind: 'offer', toUserId: kid.userId, give, want, noteId: MATE_NOTES.offer };
    }
  }
  return null;
}

/** A small gift for a kid, or null: one stack worth at most `giftMaxValue`. */
export function mateGift(
  trading: MateTradingView,
  rules: ComputerMateRules,
  rng: Rng,
  values: TradeValues = TRADE_VALUES,
): Extract<MateIntent, { kind: 'gift' }> | null {
  const items = mateItems(rules, values).filter(
    (id) => (values.items[id] ?? 0) <= rules.giftMaxValue,
  );
  if (trading.kids.length === 0 || items.length === 0) return null;
  const kid = rng.pick(trading.kids);
  const itemId = rng.pick(items);
  const quantity = Math.max(1, Math.floor(rules.giftMaxValue / (values.items[itemId] ?? 1)));
  return {
    kind: 'gift',
    toUserId: kid.userId,
    give: [{ itemId, quantity }],
    noteId: MATE_NOTES.gift,
  };
}

/**
 * The kid's offer to answer now, or null: the oldest one that has waited
 * `answerMinutes`. A no is always allowed; a yes waits while the patch
 * day's `completedPerPatchDay` is used up (the offer stays open).
 */
export function offerToAnswer(
  trading: MateTradingView,
  persona: ComputerPersonaTuning,
  rules: ComputerMateRules,
): Extract<MateIntent, { kind: 'answer-offer' }> | null {
  const room = trading.completedToday < rules.completedPerPatchDay;
  for (const offer of trading.incoming) {
    if (offer.waitedMinutes < persona.answerMinutes) continue;
    const yes = mateSaysYes(offer, rules);
    if (yes && !room) continue;
    // A gift can't be said no to from here: it waits for room.
    return { kind: 'answer-offer', offerId: offer.id, answer: yes ? 'accept' : 'decline' };
  }
  return null;
}

/**
 * One intent for this step, or null to only tend. A fire on dark land comes
 * first (outside catch-up), then a kid's offer that has waited long enough;
 * otherwise claim, guard, offer or gift, weighted by the persona, among
 * what's allowed now, and (386e) a challenge on a kid's tile. Catch-up steps only claim and tend.
 */
export function nextIntent(
  view: MateView,
  persona: ComputerPersonaTuning,
  rules: ComputerMateRules,
  rng: Rng,
): MateIntent | null {
  if (!view.catchUp && view.fires.length < firesWanted(view, rules)) {
    const spot = fireSpot(view);
    if (spot) return { kind: 'fire', ...spot };
  }
  const trading = view.catchUp || !view.trading?.enabled ? undefined : view.trading;
  if (trading) {
    const answer = offerToAnswer(trading, persona, rules);
    if (answer) return answer;
  }
  const options: { weight: number; intent: MateIntent }[] = [];
  if (
    persona.weights.claim > 0 &&
    view.claimsToday < persona.claimsPerDay &&
    outerLand(view).length < mateLandCap(view.tiles, view.seats, rules)
  ) {
    const target = claimTarget(view, rules);
    if (target)
      options.push({ weight: persona.weights.claim, intent: { kind: 'claim', ...target } });
  }
  if (
    !view.catchUp &&
    persona.weights.guard > 0 &&
    view.freeSquishies > 0 &&
    view.guarded.length < rules.guardedTiles
  ) {
    const guarded = new Set(view.guarded.map(hexKey));
    const spot = borderFacingKids(view).find((t) => !guarded.has(hexKey(t)));
    if (spot) options.push({ weight: persona.weights.guard, intent: { kind: 'guard', ...spot } });
  }
  if (trading && trading.completedToday < rules.completedPerPatchDay) {
    if (persona.weights.trade > 0 && trading.offersThisWeek < persona.offersPerWeek) {
      const offer = mateOffer(trading, rules, rng);
      if (offer) options.push({ weight: persona.weights.trade, intent: offer });
    }
    if (persona.weights.gift > 0 && trading.giftsThisWeek < rules.giftsPerPatchWeek) {
      const gift = mateGift(trading, rules, rng);
      if (gift) options.push({ weight: persona.weights.gift, intent: gift });
    }
  }
  if (persona.weights.challenge > 0 && mayChallenge(view, rules)) {
    const target = challengeTarget(view, rules);
    if (target) {
      options.push({ weight: persona.weights.challenge, intent: { kind: 'challenge', ...target } });
    }
  }
  if (options.length === 0) return null;
  return rng.weighted(options).intent;
}
