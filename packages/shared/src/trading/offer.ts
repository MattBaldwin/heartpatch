import type { TradeRules } from '../schemas/data/trading.js';
import type { SquishyState } from '../schemas/squishies.js';
import type { TradeKind, TradeLine } from '../schemas/trading.js';

// What can go into a trade or a gift (#271; owner decisions Q1 and Q2 on
// #30). Pure: the server refuses with these, and the post screen greys out
// the same things before anyone taps Send.

/** One of a player's squishies, as an offer needs to know it. */
export interface OfferSquishy {
  readonly id: string;
  /** `active`, `hollowed` or already `in-trade`. */
  readonly state: SquishyState;
  /** Resting: no team slot, watch, gathering or training (a habitat is fine). */
  readonly resting: boolean;
  /** Their patch starter (the Partner) stays with them (Q1). */
  readonly starter: boolean;
}

/** One of a player's clothing pieces. */
export interface OfferClothing {
  readonly id: string;
  /** The catalog says it can be traded (account-bound pieces can't). */
  readonly tradable: boolean;
  /** Already held for another offer. */
  readonly held: boolean;
}

/** What one side's owner has, to check their lines against. */
export interface OfferSide {
  readonly squishies: readonly OfferSquishy[];
  /** Item id → how many are in the bag. */
  readonly items: Readonly<Record<string, number>>;
  /** Item ids that can be traded (`isTradableResource`). */
  readonly tradableItems: ReadonlySet<string>;
  readonly clothing: readonly OfferClothing[];
}

/**
 * Why an offer can't be sent, or null:
 * - `empty`: nothing to give, or a trade asks for nothing (that's a gift);
 * - `gift-wants`: a gift that asks for something back;
 * - `too-many-lines` / `too-many-squishies`: past `TRADE_RULES`;
 * - `twice`: the same squishy, item or piece listed twice on one side;
 * - `not-theirs`: a line its side's owner doesn't have (or not enough of);
 * - `busy`: a squishy with a job, in the Hollow or already in a trade;
 * - `starter`: someone's patch starter (Q1);
 * - `last-friend`: it would leave its owner with no active squishy;
 * - `not-tradable`: an account-bound piece, a tool, or anything held already.
 */
export type OfferProblem =
  | 'empty'
  | 'gift-wants'
  | 'too-many-lines'
  | 'too-many-squishies'
  | 'twice'
  | 'not-theirs'
  | 'busy'
  | 'starter'
  | 'last-friend'
  | 'not-tradable';

const keyOf = (line: TradeLine): string =>
  line.kind === 'squishy'
    ? `squishy:${line.squishyId}`
    : line.kind === 'item'
      ? `item:${line.itemId}`
      : `clothing:${line.clothingId}`;

/** The problem with one side's lines against what its owner has, or null. */
export function sideProblem(
  lines: readonly TradeLine[],
  side: OfferSide,
  rules: TradeRules,
): OfferProblem | null {
  if (lines.length > rules.linesPerSide) return 'too-many-lines';
  if (lines.filter((l) => l.kind === 'squishy').length > rules.squishiesPerSide) {
    return 'too-many-squishies';
  }
  if (new Set(lines.map(keyOf)).size !== lines.length) return 'twice';
  let leaving = 0;
  for (const line of lines) {
    if (line.kind === 'squishy') {
      const squishy = side.squishies.find((s) => s.id === line.squishyId);
      if (!squishy) return 'not-theirs';
      if (squishy.starter) return 'starter';
      if (squishy.state !== 'active' || !squishy.resting) return 'busy';
      leaving += 1;
    } else if (line.kind === 'item') {
      if (!side.tradableItems.has(line.itemId)) return 'not-tradable';
      if ((side.items[line.itemId] ?? 0) < line.quantity) return 'not-theirs';
    } else {
      const piece = side.clothing.find((c) => c.id === line.clothingId);
      if (!piece) return 'not-theirs';
      if (!piece.tradable || piece.held) return 'not-tradable';
    }
  }
  const active = side.squishies.filter((s) => s.state === 'active').length;
  if (leaving > 0 && leaving >= active) return 'last-friend';
  return null;
}

/**
 * Why this offer can't be sent, or null. `sender` is checked against `give`
 * and `receiver` against `want`; the server checks again under its locks
 * when the offer is answered.
 */
export function offerProblem(
  offer: {
    readonly kind: TradeKind;
    readonly give: readonly TradeLine[];
    readonly want: readonly TradeLine[];
  },
  sender: OfferSide,
  receiver: OfferSide,
  rules: TradeRules,
): OfferProblem | null {
  if (offer.give.length === 0) return 'empty';
  if (offer.kind === 'gift' && offer.want.length > 0) return 'gift-wants';
  if (offer.kind === 'trade' && offer.want.length === 0) return 'empty';
  return sideProblem(offer.give, sender, rules) ?? sideProblem(offer.want, receiver, rules);
}
