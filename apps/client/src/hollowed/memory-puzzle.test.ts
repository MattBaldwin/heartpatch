import { describe, expect, it } from 'vitest';
import { HOLLOWED_EXPLORE } from './hollowed-config.js';
import {
  glowing,
  nextPiece,
  showing,
  startPuzzle,
  stepPuzzle,
  watchMs,
  wobbling,
  type PuzzleState,
} from './memory-puzzle.js';

const ORDER = ['drum', 'fiddle', 'bell', 'horn'];
const { showMs, gapMs, missesForGlow, wobbleMs } = HOLLOWED_EXPLORE.puzzle;

/** Taps every id in turn from `t`. */
const tapAll = (s: PuzzleState, ids: readonly string[], t = 10_000) =>
  ids.reduce((acc, id, i) => stepPuzzle(acc, { type: 'tap', id, t: t + i }), s);

describe('the memory puzzle (#306 PR 2b)', () => {
  it('shows the order one piece at a time, then hands over', () => {
    const s = startPuzzle(ORDER, 0);
    expect(s.phase).toBe('watch');
    expect(showing(s, 0)).toBe('drum');
    expect(showing(s, showMs - 1)).toBe('drum');
    // The pause between two pieces lights none.
    expect(showing(s, showMs + 1)).toBeNull();
    expect(showing(s, showMs + gapMs)).toBe('fiddle');
    expect(showing(s, 3 * (showMs + gapMs))).toBe('horn');
    expect(stepPuzzle(s, { type: 'tick', t: watchMs(4) - 1 }).phase).toBe('watch');
    const play = stepPuzzle(s, { type: 'tick', t: watchMs(4) });
    expect(play.phase).toBe('play');
    expect(showing(play, watchMs(4))).toBeNull();
  });

  it('lays the tray out the same way each time, never already in order', () => {
    for (let i = 0; i < 50; i++) {
      const seed = i / 50;
      const a = startPuzzle(ORDER, 0, seed);
      expect(startPuzzle(ORDER, 0, seed).tray).toEqual(a.tray);
      expect([...a.tray].sort()).toEqual([...ORDER].sort());
      expect(a.tray).not.toEqual(ORDER);
    }
  });

  it('is whole once every piece goes back in order', () => {
    const s = tapAll(stepPuzzle(startPuzzle(ORDER, 0), { type: 'ready', t: 1 }), ORDER);
    expect(s.placed).toEqual(ORDER);
    expect(s.phase).toBe('done');
    expect(nextPiece(s)).toBeNull();
    // Nothing moves it after that.
    expect(stepPuzzle(s, { type: 'again', t: 20_000 })).toBe(s);
  });

  it('starts the kid’s turn on a tap while it still shows', () => {
    const s = stepPuzzle(startPuzzle(ORDER, 0), { type: 'tap', id: 'drum', t: 10 });
    expect(s).toMatchObject({ phase: 'play', placed: ['drum'] });
  });

  it('only wobbles on a wrong tap, then glows the next piece after a couple', () => {
    let s = stepPuzzle(startPuzzle(ORDER, 0), { type: 'ready', t: 0 });
    s = stepPuzzle(s, { type: 'tap', id: 'horn', t: 100 });
    expect(s.placed).toEqual([]);
    expect(wobbling(s, 'horn', 100 + wobbleMs - 1)).toBe(true);
    expect(wobbling(s, 'horn', 100 + wobbleMs)).toBe(false);
    for (let i = 1; i < missesForGlow; i++) {
      expect(glowing(s)).toBeNull();
      s = stepPuzzle(s, { type: 'tap', id: 'bell', t: 200 + i });
    }
    expect(glowing(s)).toBe('drum');
    // A right tap puts it back and the glow rests.
    s = stepPuzzle(s, { type: 'tap', id: 'drum', t: 400 });
    expect(s).toMatchObject({ placed: ['drum'], misses: 0, wobble: null });
    expect(glowing(s)).toBeNull();
  });

  it('ignores a piece already back, or one that isn’t in it', () => {
    const s = tapAll(stepPuzzle(startPuzzle(ORDER, 0), { type: 'ready', t: 0 }), ['drum']);
    expect(stepPuzzle(s, { type: 'tap', id: 'drum', t: 5 })).toBe(s);
    expect(stepPuzzle(s, { type: 'tap', id: 'kazoo', t: 5 })).toBe(s);
  });

  it('has an easy way: the next piece goes back by itself, all the way', () => {
    let s = startPuzzle(ORDER, 0);
    for (const id of ORDER) {
      expect(nextPiece(s)).toBe(id);
      s = stepPuzzle(s, { type: 'easy', t: 1 });
    }
    expect(s).toMatchObject({ phase: 'done', placed: ORDER });
  });

  it('shows the order again and keeps what’s back', () => {
    const s = tapAll(stepPuzzle(startPuzzle(ORDER, 0), { type: 'ready', t: 0 }), ['drum']);
    const again = stepPuzzle(s, { type: 'again', t: 5_000 });
    expect(again).toMatchObject({ phase: 'watch', placed: ['drum'], watchSince: 5_000 });
    expect(showing(again, 5_000)).toBe('drum');
  });
});
