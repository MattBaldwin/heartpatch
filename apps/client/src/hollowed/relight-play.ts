import {
  applyRelightMove,
  lightOf,
  slidesFrom,
  type RelightBoard,
  type RelightLight,
  type RelightMove,
} from '@heartpatch/shared';

/*
 * A Relight try as the card plays it (#306 PR 2b, owner decisions
 * 2026-10-22): tap a path piece or a lantern to turn it; tap a wooden piece
 * to slide it into the empty slot beside it (with two slots beside it, tap
 * it, then the slot). Every move counts. Light every lantern within the
 * limit and the moves go to the server, which replays them on its own copy
 * of the board (CLAUDE.md rule 1). Run out of moves, or give up, and the
 * light fades: the next try is a new path. No hints, no peeking. A pure
 * reducer, so every case is unit-tested.
 */

export type RelightOutcome = 'playing' | 'won' | 'faded';

export interface RelightPlay {
  /** This try's number (`StartPuzzleResponse.attempt`), sent back with the moves. */
  readonly attempt: number;
  readonly board: RelightBoard;
  readonly moves: readonly RelightMove[];
  /** A wooden piece picked to slide, waiting for its slot. */
  readonly picked: number | null;
  readonly outcome: RelightOutcome;
  /** Why the last tap did nothing, for the card's line. */
  readonly bump: 'stuck' | 'one-step' | null;
}

export function startRelight(attempt: number, board: RelightBoard): RelightPlay {
  return { attempt, board, moves: [], picked: null, outcome: 'playing', bump: null };
}

/** Where the light reaches now. */
export function relightLight(play: RelightPlay): RelightLight {
  return lightOf(play.board);
}

/** Moves left before the light fades. */
export function movesLeft(play: RelightPlay): number {
  return Math.max(0, play.board.limit - play.moves.length);
}

/** One tap on cell `at`. */
export function tapRelight(play: RelightPlay, at: number): RelightPlay {
  if (play.outcome !== 'playing') return play;
  const cell = play.board.cells[at];
  if (!cell || cell.kind === 'heart' || cell.kind === 'shadow') return play;
  if (cell.kind === 'empty') {
    if (play.picked === null) return play;
    const move: RelightMove = { type: 'slide', at: play.picked, to: at };
    if (!applyRelightMove(play.board, move)) {
      return { ...play, picked: null, bump: 'one-step' };
    }
    return moved(play, move);
  }
  if (cell.loose) {
    const slots = slidesFrom(play.board, at);
    if (slots.length === 0) return { ...play, picked: null, bump: 'stuck' };
    if (slots.length === 1) return moved(play, { type: 'slide', at, to: slots[0] as number });
    return { ...play, picked: play.picked === at ? null : at, bump: null };
  }
  return moved(play, { type: 'turn', at });
}

/** Giving up: the light fades, and the next try is a new path. */
export function giveUpRelight(play: RelightPlay): RelightPlay {
  return play.outcome === 'playing'
    ? { ...play, picked: null, outcome: 'faded', bump: null }
    : play;
}

function moved(play: RelightPlay, move: RelightMove): RelightPlay {
  const board = applyRelightMove(play.board, move);
  if (!board) return play;
  const moves = [...play.moves, move];
  const won = lightOf(board).won;
  const outcome: RelightOutcome = won ? 'won' : moves.length >= board.limit ? 'faded' : 'playing';
  return { ...play, board, moves, picked: null, outcome, bump: null };
}
