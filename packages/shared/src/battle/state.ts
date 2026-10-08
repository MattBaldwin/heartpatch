import type { RngState } from '../rng/index.js';
import { BattleRuleError } from './content.js';
import type { BattleController, BattleSideId, BattleStats } from '../schemas/battle.js';
import type { ElementId, FeelingId } from '../schemas/data/elements.js';
import type { BattleStat, MoveEffect } from '../schemas/data/moves.js';

/** A status a move can cause (the move schema's `status` effect). */
export type BattleStatusId = Extract<MoveEffect, { type: 'status' }>['status'];

export interface BattleSquishy {
  readonly id: string;
  readonly speciesId: string;
  readonly level: number;
  readonly element: ElementId;
  readonly feeling: FeelingId;
  /** Stats at its level; `stats.hp` is a full energy bar. */
  readonly stats: BattleStats;
  readonly moves: readonly string[];
  /** Current energy; 0 means tuckered out. */
  readonly energy: number;
  /** Stat stages from moves; reset when it swaps out. */
  readonly stages: Readonly<Record<BattleStat, number>>;
  readonly status: { readonly id: BattleStatusId; readonly turnsLeft: number } | null;
  /** Has been out in this battle, so it earns battle XP. */
  readonly joined: boolean;
  /**
   * A fence segment (#203), by building id: it has energy and toughness but
   * never makes a move, can't be befriended, and its feeling is ignored in
   * the maths (its matchup is its material's element).
   */
  readonly fence?: string;
  /**
   * Potion boosts in percent (#214): Brave Brew's attack, Cozy Cocoa's
   * defense. They last the rest of the battle, swaps included.
   */
  readonly boosts: Readonly<Record<BattleBoostStat, number>>;
  /** Percent taken off the next hit it takes (a potion's shield, #214); 0 is none. */
  readonly shield: number;
  /**
   * Said yes to a Heart Charm and left mid-battle (#279): it has joined the
   * other side's Keeper and is out of the fight, as if tuckered out, but keeps
   * its energy (battle XP counts only tuckered-out squishies). The last one
   * befriended isn't marked: the battle ends `captured` with it still out.
   */
  readonly befriended?: true;
}

/** The stats a potion can boost (#214). */
export type BattleBoostStat = 'attack' | 'defense';

export interface BattleSide {
  readonly controller: BattleController;
  readonly squishies: readonly BattleSquishy[];
  /** Slot of the squishy that's out. */
  readonly active: number;
  /** Battle items this side used, in order (#214): each kind only `rules.items.usesEach` times. */
  readonly itemsUsed: readonly string[];
}

export type BattleEndReason = 'tuckered-out' | 'forfeit' | 'turn-limit' | 'captured';

export interface BattleXpAward {
  readonly side: BattleSideId;
  readonly squishyId: string;
  /** Base battle XP; care and habitat multipliers are applied later (design doc §7). */
  readonly xp: number;
}

export interface BattleResult {
  readonly winner: BattleSideId | 'draw';
  readonly reason: BattleEndReason;
  /** The `BattleContent.contentHash` the battle was played with. */
  readonly contentHash: string;
  /** Turns played. */
  readonly turns: number;
  readonly xp: readonly BattleXpAward[];
}

export type BattlePhase =
  | { readonly type: 'turn' }
  /** Waiting for these player sides to send a `replace` action. */
  | { readonly type: 'replace'; readonly sides: readonly BattleSideId[] }
  | { readonly type: 'over'; readonly result: BattleResult };

/** Where a squishy stands: its side and team slot. */
interface At {
  readonly turn: number;
  readonly side: BattleSideId;
  readonly slot: number;
}

/**
 * What happened, in order, for the UI to animate (design doc §6). Events hold
 * ids and numbers only; player-facing words come from data (effectiveness
 * callouts) or the client, so the log never needs avoided words.
 */
export type BattleEvent =
  | (At & { readonly type: 'swap'; readonly to: number })
  | (At & { readonly type: 'replace' })
  | (At & { readonly type: 'move'; readonly move: string })
  /** The move at `side`/`slot` didn't land. */
  | (At & { readonly type: 'miss'; readonly move: string })
  /**
   * The squishy at `side`/`slot` lost `amount` energy. `effectiveness` is a
   * tier id from battle rules; the UI shows that tier's callout.
   */
  | (At & {
      readonly type: 'hit';
      readonly amount: number;
      readonly energy: number;
      readonly effectiveness: string;
      /** A potion's shield took some of it (#214), and is now used up. */
      readonly shielded?: true;
    })
  | (At & { readonly type: 'heal'; readonly amount: number; readonly energy: number })
  /** `stages` is the change actually applied (0 if already at the limit). */
  | (At & {
      readonly type: 'stat-change';
      readonly stat: BattleStat;
      readonly stages: number;
      readonly total: number;
    })
  | (At & { readonly type: 'status-start'; readonly status: BattleStatusId })
  /** Too sleepy or dizzy to act this turn. */
  | (At & { readonly type: 'status-skip'; readonly status: BattleStatusId })
  | (At & { readonly type: 'status-end'; readonly status: BattleStatusId })
  | (At & { readonly type: 'tuckered-out' })
  /**
   * The squishy at `side`/`slot` used a battle item (a potion, #214). Its
   * effects follow as `heal` events; boosts and the shield are in the state.
   */
  | (At & { readonly type: 'item'; readonly item: string })
  /**
   * A Heart Charm was offered to the squishy at `side`/`slot` (the other side
   * offered it). `caught`: it said yes and left the fight, like a knockout
   * (#279); the battle ends if nobody is left on its side.
   */
  | (At & { readonly type: 'capture'; readonly caught: boolean })
  | { readonly turn: number; readonly type: 'forfeit'; readonly side: BattleSideId }
  | {
      readonly turn: number;
      readonly type: 'battle-end';
      readonly winner: BattleSideId | 'draw';
      readonly reason: BattleEndReason;
    };

/**
 * The whole battle as plain JSON. The seeded RNG's state lives here, so each
 * step is a pure function of (state, action): see `applyBattleAction`.
 */
export interface BattleState {
  /** Bumped if the shape changes, so stored battles can be migrated. */
  readonly version: 1;
  /** The `BattleContent.contentHash` this battle must be played with. */
  readonly contentHash: string;
  /** Turns resolved so far. */
  readonly turn: number;
  /** Turns it lasts at most, when less than the rules' `maxTurns` (a fence battle, #203). */
  readonly turnLimit?: number;
  readonly rng: RngState;
  readonly sides: Readonly<Record<BattleSideId, BattleSide>>;
  readonly phase: BattlePhase;
  /** Every event so far, oldest first. */
  readonly log: readonly BattleEvent[];
}

/** A deep, writable copy type; the engine only ever writes to its own copy. */
export type Draft<T> = T extends object ? { -readonly [K in keyof T]: Draft<T[K]> } : T;

export const otherSide = (side: BattleSideId): BattleSideId => (side === 'a' ? 'b' : 'a');

/** The squishy that's out for `side`. */
export function activeSquishy<S extends BattleState | Draft<BattleState>>(
  state: S,
  side: BattleSideId,
): S['sides'][BattleSideId]['squishies'][number] {
  const { squishies, active } = state.sides[side];
  const squishy = squishies[active];
  if (!squishy) throw new BattleRuleError(`side ${side} has no squishy in slot ${active}`);
  return squishy;
}

/** Still in the fight: not tuckered out and not befriended (#279). */
export function inPlay(squishy: Pick<BattleSquishy, 'energy' | 'befriended'>): boolean {
  return squishy.energy > 0 && squishy.befriended !== true;
}

/** Squishies that could come out for `side`: not the active one, still in the fight. */
export function benchOf(
  state: BattleState,
  side: BattleSideId,
): { slot: number; squishy: BattleSquishy }[] {
  const { squishies, active } = state.sides[side];
  return squishies.flatMap((squishy, slot) =>
    slot !== active && inPlay(squishy) ? [{ slot, squishy }] : [],
  );
}

/**
 * The squishies on `side` that said yes to a Heart Charm between `before`
 * and `after` (one step), in team order: ones that left mid-battle (#279),
 * and the last one when the step ended the battle `captured` (it is still
 * out). Who gets a new friend from that step.
 */
export function befriendedBetween(
  before: BattleState,
  after: BattleState,
  side: BattleSideId,
): BattleSquishy[] {
  const was = before.sides[side].squishies;
  const { squishies, active } = after.sides[side];
  const { phase } = after;
  const lastOne =
    phase.type === 'over' &&
    phase.result.reason === 'captured' &&
    phase.result.winner === otherSide(side);
  return squishies.filter(
    (squishy, slot) =>
      (squishy.befriended === true && was[slot]?.befriended !== true) ||
      (lastOne && slot === active),
  );
}
