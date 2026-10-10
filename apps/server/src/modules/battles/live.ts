import {
  applyBattleAction,
  coverChoice,
  coverReplacement,
  liveTurnAction,
  otherSide,
  sidesToAct,
  type BattleAction,
  type BattleChoice,
  type BattleContent,
  type BattleSideId,
  type BattleState,
  type LiveBattleRules,
  type LiveBattleView,
} from '@heartpatch/shared';
import type { LiveCover, LiveRow } from './repo.js';

/*
 * Live battles (#29): both sides are players. A pick waits, hidden, until the
 * other side's arrives; then the turn plays as one engine action. When a
 * side's time runs out the AI picks for it (never a loss), and that choice is
 * stored in the action list like any other, so the battle still replays from
 * its seed and actions (CLAUDE.md rule 3). Timeouts are timestamps, settled on
 * the next read or action by either player (rule 4): idle battles cost nothing.
 */

const SECOND_MS = 1000;

/** One side's turn state after a step: its row patch and the actions it took. */
export interface LiveStep {
  state: BattleState;
  actions: BattleAction[];
  live: Pick<LiveRow, 'picks' | 'deadlineAt' | 'graceUsed' | 'covered'>;
}

/** The deadline for a step that starts at `from`. */
export function nextDeadline(from: Date, rules: LiveBattleRules): Date {
  return new Date(from.getTime() + rules.turnSeconds * SECOND_MS);
}

/**
 * Settles every deadline that passed by `at`, oldest first: a side still
 * owing a pick gets one away-grace if it isn't connected (`isOnline`), else
 * the AI picks for it in its cover style. Several turns may play in one go
 * when nobody looked for a while; each one's deadline counts from the last,
 * so the AI's picks never depend on when somebody next looked. Whether a side
 * gets its away-grace does: `isOnline` is asked when this runs, not at the
 * deadline. Stops when the battle ends or the next deadline is still ahead.
 */
export function settleTimeouts(input: {
  content: BattleContent;
  seed: string;
  state: BattleState;
  live: LiveRow;
  at: Date;
  rules: LiveBattleRules;
  isOnline: (side: BattleSideId) => boolean;
}): LiveStep {
  const { content, seed, at, rules, isOnline } = input;
  let { state } = input;
  let picks = { ...input.live.picks };
  let deadlineAt = input.live.deadlineAt;
  const graceUsed = { ...input.live.graceUsed };
  const covered: LiveCover[] = [...input.live.covered];
  const actions: BattleAction[] = [];
  // Every pass either spends a grace or plays a step, so this is bounded by
  // the battle's turn limit; the cap is only a guard against a bad state.
  for (let guard = 0; guard < 4 * content.rules.maxTurns + 8; guard++) {
    if (state.phase.type === 'over' || at.getTime() < deadlineAt.getTime()) break;
    const owed = sidesToAct(state);
    const missing = state.phase.type === 'turn' ? owed.filter((side) => !picks[side]) : owed;
    const away = missing.filter((side) => !isOnline(side) && !graceUsed[side]);
    if (away.length > 0 && rules.awayGraceSeconds > 0) {
      for (const side of away) graceUsed[side] = true;
      deadlineAt = new Date(deadlineAt.getTime() + rules.awayGraceSeconds * SECOND_MS);
      continue;
    }
    let action: BattleAction;
    if (state.phase.type === 'turn') {
      const full: Partial<Record<BattleSideId, BattleChoice>> = { ...picks };
      for (const side of missing) {
        full[side] = coverChoice(content, state, side, input.live.coverPolicy[side], seed);
        covered.push({ turn: state.turn + 1, side });
      }
      const turn = liveTurnAction(state, full);
      if (!turn) throw new Error('settleTimeouts: a covered turn is still missing a pick');
      action = turn;
    } else {
      // A replace phase: sides send someone out one at a time.
      const [side] = missing;
      if (!side) throw new Error('settleTimeouts: a replace phase with nobody to send out');
      action = coverReplacement(content, state, side, input.live.coverPolicy[side], seed);
      covered.push({ turn: state.turn, side });
    }
    state = applyBattleAction(content, state, action);
    actions.push(action);
    picks = {};
    deadlineAt = nextDeadline(deadlineAt, rules);
  }
  return { state, actions, live: { picks, deadlineAt, graceUsed, covered } };
}

/** What a live battle's player sees of its turn state (never the other side's pick). */
export function liveView(
  live: LiveRow,
  mySide: BattleSideId,
  opponentUserId: string,
  active: boolean,
  opponentHere: boolean,
): LiveBattleView {
  return {
    opponentUserId,
    opponentHere,
    deadlineAt: active ? live.deadlineAt.toISOString() : null,
    myPick: live.picks[mySide] ?? null,
    opponentPicked: live.picks[otherSide(mySide)] !== undefined,
    covered: live.covered.map(({ turn, side }) => ({ turn, side })),
  };
}
