import { describe, expect, it } from 'vitest';
import { MEMORY_PUZZLES } from '../data/memory-puzzles.js';
import { RelightBoardSchema, type RelightBoard } from '../schemas/explore.js';
import {
  RELIGHT_E,
  RELIGHT_N,
  RELIGHT_S,
  RELIGHT_W,
  applyRelightMove,
  checkRelight,
  lightOf,
  makeRelight,
  relightBoard,
  relightDepth,
  relightSeed,
  slidesFrom,
  turnOpenings,
} from './relight.js';

const TIERS = MEMORY_PUZZLES.relight;
const SEEDS = 120;

describe('turnOpenings (#306 PR 2b)', () => {
  it('turns a quarter clockwise, and four turns come home', () => {
    expect(turnOpenings(RELIGHT_N)).toBe(RELIGHT_E);
    expect(turnOpenings(RELIGHT_W)).toBe(RELIGHT_N);
    expect(turnOpenings(RELIGHT_N | RELIGHT_E, 2)).toBe(RELIGHT_S | RELIGHT_W);
    for (let m = 0; m < 16; m++) expect(turnOpenings(m, 4)).toBe(m);
  });
});

describe('relightDepth (#306 PR 2b)', () => {
  // A square with its six neighbours: the ring is all rim, the square the heart.
  const square = { q: 0, r: 0 };
  const ring = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  it('makes the square the heart and a tile touching outside the rim', () => {
    const village = [square, ...ring];
    expect(relightDepth(square, square, village)).toBe('heart');
    for (const t of ring) expect(relightDepth(t, square, village)).toBe('rim');
  });

  it('makes a tile with only Hollow round it inner', () => {
    // The square sits at the edge; (0,0) is wholly surrounded.
    const edge = { q: 2, r: 0 };
    expect(relightDepth({ q: 0, r: 0 }, edge, [square, ...ring, edge])).toBe('inner');
  });
});

describe('makeRelight (#306 PR 2b)', () => {
  it('is the same puzzle for the same seed, and a new one for each try', () => {
    const a = makeRelight(relightSeed('hollow', { q: 1, r: 2 }, 'kid', 1), TIERS.rim);
    expect(makeRelight(relightSeed('hollow', { q: 1, r: 2 }, 'kid', 1), TIERS.rim)).toEqual(a);
    for (const seed of [
      relightSeed('hollow', { q: 1, r: 2 }, 'kid', 2),
      relightSeed('hollow', { q: 1, r: 2 }, 'other-kid', 1),
      relightSeed('hollow', { q: 2, r: 2 }, 'kid', 1),
    ]) {
      expect(makeRelight(seed, TIERS.rim).cells).not.toEqual(a.cells);
    }
  });

  for (const [depth, tier] of Object.entries(TIERS)) {
    it(`builds ${depth} boards as the tier says, solvable by construction`, () => {
      for (let s = 0; s < SEEDS; s++) {
        const puzzle = makeRelight(`seed-${depth}-${String(s)}`, tier);
        const count = (kind: string) => puzzle.cells.filter((c) => c.kind === kind).length;
        expect(puzzle.cells).toHaveLength(tier.size * tier.size);
        expect(count('heart')).toBe(1);
        expect(puzzle.cells[puzzle.heart]?.kind).toBe('heart');
        expect(Math.floor(puzzle.heart / tier.size)).toBe(tier.size - 1);
        expect(count('lantern')).toBe(tier.lanterns);
        expect(count('shadow')).toBe(tier.shadows);
        expect(count('empty')).toBe(tier.empty);
        expect(puzzle.cells.filter((c) => c.loose)).toHaveLength(tier.loose);
        // Work ≥ minWork, limit = work + slack, and never lit to begin with.
        expect(puzzle.work).toBeGreaterThanOrEqual(tier.minWork);
        expect(puzzle.limit).toBe(puzzle.work + tier.slack);
        expect(lightOf(puzzle).won).toBe(false);
        // Its own undo is a legal solution of exactly `work` moves.
        expect(puzzle.solution).toHaveLength(puzzle.work);
        expect(checkRelight(puzzle, puzzle.solution)).toEqual({ ok: true });
      }
    });
  }

  it('gives the client the board only, never the solution', () => {
    const puzzle = makeRelight('seed', TIERS.inner);
    const board = relightBoard(puzzle);
    expect(Object.keys(board).sort()).toEqual(['cells', 'heart', 'limit', 'size']);
    expect(RelightBoardSchema.parse(board)).toEqual(board);
  });
});

/** A hand-made 3×3 board: heart at the bottom middle, a lantern above it, a shadow top right. */
function tiny(): RelightBoard {
  const pipe = (open: number, loose = false) => ({ kind: 'pipe' as const, open, loose });
  return {
    size: 3,
    heart: 7,
    limit: 3,
    cells: [
      pipe(RELIGHT_E | RELIGHT_S),
      { kind: 'lantern', open: RELIGHT_S | RELIGHT_E, loose: false },
      { kind: 'shadow', open: 0, loose: false },
      pipe(RELIGHT_N | RELIGHT_S, true),
      { kind: 'empty', open: 0, loose: false },
      pipe(RELIGHT_E),
      pipe(RELIGHT_N),
      { kind: 'heart', open: RELIGHT_N, loose: false },
      pipe(RELIGHT_W),
    ],
  };
}

describe('lightOf and applyRelightMove (#306 PR 2b)', () => {
  it('lights only through openings that meet', () => {
    const board = tiny();
    // The heart opens north into the empty slot: nothing else is lit.
    expect([...lightOf(board).lit]).toEqual([7]);
    expect(lightOf(board).litLanterns).toBe(0);
  });

  it('slides a wooden piece into the empty slot beside it, and never turns it', () => {
    const board = tiny();
    expect(slidesFrom(board, 3)).toEqual([4]);
    expect(applyRelightMove(board, { type: 'turn', at: 3 })).toBeNull();
    const slid = applyRelightMove(board, { type: 'slide', at: 3, to: 4 });
    expect(slid?.cells[4]).toEqual({ kind: 'pipe', open: RELIGHT_N | RELIGHT_S, loose: true });
    expect(slid?.cells[3]?.kind).toBe('empty');
    // The heart, a shadow, an empty slot, a fixed piece's slide and a far slot are refused.
    for (const move of [
      { type: 'turn' as const, at: 7 },
      { type: 'turn' as const, at: 2 },
      { type: 'turn' as const, at: 4 },
      { type: 'slide' as const, at: 0, to: 4 },
      { type: 'slide' as const, at: 3, to: 5 },
      { type: 'turn' as const, at: 99 },
    ]) {
      expect(applyRelightMove(board, move)).toBeNull();
    }
  });

  it('goes dark when light touches an echo, and wins once every lantern is lit', () => {
    const slide = { type: 'slide' as const, at: 3, to: 4 };
    const slid = applyRelightMove(tiny(), slide);
    if (!slid) throw new Error('slide');
    // Light climbs to the lantern, which opens east into the shadow: all dark.
    const spooked = lightOf(slid);
    expect(spooked.spooked).toBe(2);
    expect(spooked.lit.size).toBe(0);
    expect(spooked.won).toBe(false);
    expect(checkRelight(tiny(), [slide])).toEqual({ ok: false, why: 'not-lit' });
    // A quarter turn points it west instead, at a piece that leads nowhere bad.
    const won = applyRelightMove(slid, { type: 'turn', at: 1 });
    expect(won && lightOf(won)).toMatchObject({ won: true, litLanterns: 1, spooked: null });
    expect(checkRelight(tiny(), [slide, { type: 'turn', at: 1 }])).toEqual({ ok: true });
  });
});

describe('checkRelight (#306 PR 2b)', () => {
  const puzzle = makeRelight('check-seed', TIERS.rim);
  it('refuses more moves than the limit, an illegal move, and a board left dark', () => {
    const turns = Array.from({ length: puzzle.limit + 1 }, () => puzzle.solution[0]!);
    expect(checkRelight(puzzle, turns)).toEqual({ ok: false, why: 'too-many-moves' });
    expect(checkRelight(puzzle, [{ type: 'turn', at: puzzle.heart }])).toEqual({
      ok: false,
      why: 'illegal-move',
    });
    expect(checkRelight(puzzle, [])).toEqual({ ok: false, why: 'not-lit' });
    expect(checkRelight(puzzle, puzzle.solution)).toEqual({ ok: true });
  });
});
