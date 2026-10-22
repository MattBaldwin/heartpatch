import {
  MEMORY_PUZZLES,
  RELIGHT_E,
  RELIGHT_N,
  RELIGHT_S,
  RELIGHT_W,
  makeRelight,
  relightBoard,
  type RelightBoard,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  giveUpRelight,
  movesLeft,
  relightLight,
  startRelight,
  tapRelight,
  type RelightPlay,
} from './relight-play.js';

const pipe = (open: number, loose = false) => ({ kind: 'pipe' as const, open, loose });
const empty = { kind: 'empty' as const, open: 0, loose: false };

/**
 * 3×3, heart at the bottom middle opening north. A wooden straight sits
 * left of the middle; the middle and the top-left corner are empty slots.
 * The lantern (top middle) opens east into an echo until it's turned.
 */
function board(limit = 4): RelightBoard {
  return {
    size: 3,
    heart: 7,
    limit,
    cells: [
      empty,
      { kind: 'lantern', open: RELIGHT_S | RELIGHT_E, loose: false },
      { kind: 'shadow', open: 0, loose: false },
      pipe(RELIGHT_N | RELIGHT_S, true),
      empty,
      pipe(RELIGHT_E),
      pipe(RELIGHT_N),
      { kind: 'heart', open: RELIGHT_N, loose: false },
      pipe(RELIGHT_W),
    ],
  };
}

const tap = (play: RelightPlay, ...at: number[]) => at.reduce(tapRelight, play);

describe('a Relight try (#306 PR 2b)', () => {
  it('turns a path piece a quarter with each tap, one move each', () => {
    const play = tap(startRelight(1, board()), 5);
    expect(play.board.cells[5]?.open).toBe(RELIGHT_S);
    expect(play.moves).toEqual([{ type: 'turn', at: 5 }]);
    expect(movesLeft(play)).toBe(3);
  });

  it('never moves the heart or an echo, and an empty slot alone does nothing', () => {
    const start = startRelight(1, board());
    for (const at of [7, 2, 4, 99]) expect(tapRelight(start, at)).toBe(start);
  });

  it('picks a wooden piece with two slots beside it, then slides it where you tap', () => {
    const picked = tap(startRelight(1, board()), 3);
    expect(picked.picked).toBe(3);
    expect(picked.moves).toEqual([]);
    // Tapping it again puts it down.
    expect(tapRelight(picked, 3).picked).toBeNull();
    const slid = tapRelight(picked, 4);
    expect(slid.moves).toEqual([{ type: 'slide', at: 3, to: 4 }]);
    expect(slid.board.cells[4]).toEqual(pipe(RELIGHT_N | RELIGHT_S, true));
    expect(slid.picked).toBeNull();
  });

  it('says why a slide did nothing: too far, or stuck', () => {
    const withCell = (at: number, cell: RelightBoard['cells'][number], b = board()) => ({
      ...b,
      cells: b.cells.map((c, i) => (i === at ? cell : c)),
    });
    // A third slot, but not beside it: picked, then refused.
    const picked = tap(startRelight(1, withCell(8, empty)), 3);
    expect(tapRelight(picked, 8)).toMatchObject({ bump: 'one-step', picked: null, moves: [] });
    // No slot beside it at all.
    const boxedIn = withCell(0, pipe(RELIGHT_N), withCell(4, pipe(RELIGHT_N)));
    expect(tap(startRelight(1, boxedIn), 3)).toMatchObject({ bump: 'stuck', moves: [] });
  });

  it('flares the echo, then wins once every lantern glows', () => {
    const spooked = tap(startRelight(1, board()), 3, 4);
    expect(relightLight(spooked).spooked).toBe(2);
    expect(spooked.outcome).toBe('playing');
    const won = tapRelight(spooked, 1);
    expect(won.outcome).toBe('won');
    expect(relightLight(won)).toMatchObject({ won: true, litLanterns: 1, lanterns: 1 });
    // A finished try takes no more taps.
    expect(tapRelight(won, 5)).toBe(won);
  });

  it('fades once the moves run out, and on giving up', () => {
    const out = tap(startRelight(1, board(2)), 5, 5);
    expect(out.outcome).toBe('faded');
    expect(movesLeft(out)).toBe(0);
    expect(tapRelight(out, 5)).toBe(out);
    expect(giveUpRelight(startRelight(1, board())).outcome).toBe('faded');
  });

  it('wins a real board by its own answer, within the limit', () => {
    for (const depth of ['rim', 'inner', 'heart'] as const) {
      const puzzle = makeRelight(`client-${depth}`, MEMORY_PUZZLES.relight[depth]);
      let play = startRelight(1, relightBoard(puzzle));
      for (const move of puzzle.solution) {
        // A slide is a tap on the piece, then (with two slots) on its slot.
        play = tapRelight(play, move.at);
        if (move.type === 'slide' && play.picked !== null) play = tapRelight(play, move.to);
      }
      expect(play.outcome).toBe('won');
      expect(play.moves.length).toBeLessThanOrEqual(puzzle.limit);
    }
  });
});
