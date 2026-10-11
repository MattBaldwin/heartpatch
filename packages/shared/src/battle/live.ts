import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { BattleAction, BattleChoice, BattleSideId } from '../schemas/battle.js';
import type { BattleAiPolicy } from '../schemas/data/battle.js';
import { chooseAiChoice, chooseAiReplacement } from './ai.js';
import { BattleRuleError, type BattleContent } from './content.js';
import { activeSquishy, type BattleState } from './state.js';

// Live battles (#29): both sides are players, so the server collects a pick
// from each and applies one `turn` action. When a side runs out of time, the
// AI picks for it here, outside the reducer, and the server stores that
// concrete choice in the action list: the battle still replays from
// `replayBattle(setup, actions)`, and the battle's own RNG stream is never
// touched by a timeout.

const SIDES: readonly BattleSideId[] = ['a', 'b'];

/**
 * The player sides that owe something right now: a turn choice in the
 * `turn` phase (a fence never chooses), or who comes out in `replace`.
 */
export function sidesToAct(state: BattleState): BattleSideId[] {
  const { phase } = state;
  if (phase.type === 'over') return [];
  if (phase.type === 'replace') return [...phase.sides];
  return SIDES.filter(
    (side) =>
      state.sides[side].controller.type === 'player' &&
      activeSquishy(state, side).fence === undefined,
  );
}

/**
 * The turn action once every side that owes a choice has one in `picks`, or
 * null while someone is still picking. Picks for sides that owe nothing are
 * refused, so a stale pick can't slip into the next turn.
 */
export function liveTurnAction(
  state: BattleState,
  picks: Partial<Record<BattleSideId, BattleChoice>>,
): BattleAction | null {
  if (state.phase.type !== 'turn') {
    throw new BattleRuleError(`no turn to pick for in the ${state.phase.type} phase`);
  }
  const owed = sidesToAct(state);
  for (const side of SIDES) {
    if (picks[side] && !owed.includes(side)) {
      throw new BattleRuleError(`side ${side} has nothing to pick this turn`);
    }
  }
  if (owed.some((side) => !picks[side])) return null;
  const choices: { a?: BattleChoice; b?: BattleChoice } = {};
  for (const side of owed) choices[side] = picks[side];
  return { type: 'turn', choices };
}

/** One fresh RNG per covered pick, from the battle's seed: replay never needs it. */
function coverRng(seed: Seed, state: BattleState, side: BattleSideId, kind: string): Rng {
  return Rng.fromSeed(deriveSeed(seed, 'live-cover', kind, state.turn, side));
}

/**
 * The AI's turn choice for a player side whose time ran out (never a loss,
 * #29). Moves and swaps only: the AI never spends a potion or a Heart Charm.
 */
export function coverChoice(
  content: BattleContent,
  state: BattleState,
  side: BattleSideId,
  policy: BattleAiPolicy,
  seed: Seed,
): BattleChoice {
  if (!sidesToAct(state).includes(side) || state.phase.type !== 'turn') {
    throw new BattleRuleError(`side ${side} has nothing to pick this turn`);
  }
  return chooseAiChoice(content, state, side, policy, coverRng(seed, state, side, 'turn'));
}

/** The AI's `replace` action for a player side whose time ran out. */
export function coverReplacement(
  content: BattleContent,
  state: BattleState,
  side: BattleSideId,
  policy: BattleAiPolicy,
  seed: Seed,
): BattleAction {
  if (state.phase.type !== 'replace' || !state.phase.sides.includes(side)) {
    throw new BattleRuleError(`side ${side} has nobody to replace`);
  }
  const slot = chooseAiReplacement(
    content,
    state,
    side,
    policy,
    coverRng(seed, state, side, 'replace'),
  );
  return { type: 'replace', side, slot };
}
