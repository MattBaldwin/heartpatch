import { hexEquals, hexKey, hexNeighbors, type Hex } from '../hex/index.js';
import type { RelightDepth, RelightTier } from '../schemas/data/memory-puzzles.js';
import type { RelightBoard, RelightCell, RelightMove } from '../schemas/explore.js';
import { Rng, deriveSeed, type Seed } from '../rng/index.js';

// "Relight the path" (#306 PR 2b, owner decisions 2026-10-22; ported from
// the approved mockup). A square grid of path pieces: light flows from the
// heart (bottom row) through pieces whose openings meet, and the kid turns
// and slides pieces until every lantern glows within the move limit. Light
// that touches an echo shadow is snuffed out, and the whole line goes dark.
//
// Pure and seeded: the server makes a try's puzzle from its seed, sends the
// board, and later rebuilds it from the same seed to replay the kid's moves
// (CLAUDE.md rule 1). The board on the wire holds each piece's openings as
// they are now, never how they sit when solved, so it can't give the answer
// away (no easy way).

/** Openings are a 4-bit mask: north, east, south, west. */
export const RELIGHT_N = 1;
export const RELIGHT_E = 2;
export const RELIGHT_S = 4;
export const RELIGHT_W = 8;

const DIRS = [
  { bit: RELIGHT_N, dr: -1, dc: 0, back: RELIGHT_S },
  { bit: RELIGHT_E, dr: 0, dc: 1, back: RELIGHT_W },
  { bit: RELIGHT_S, dr: 1, dc: 0, back: RELIGHT_N },
  { bit: RELIGHT_W, dr: 0, dc: -1, back: RELIGHT_E },
] as const;

/** Decoy pieces off the path: a straight, a corner or a T. */
const DECOYS = [RELIGHT_N | RELIGHT_S, RELIGHT_N | RELIGHT_E, RELIGHT_N | RELIGHT_E | RELIGHT_S];
/** Tries at one seed before giving up (the mockup never needed more than a handful). */
const TRIES = 200;
/** Scramble slides: at most this many picks, and three slides a wooden piece. */
const SLIDE_PICKS = 40;
const SLIDES_PER_PIECE = 3;

/** A quarter turn clockwise. */
export function turnOpenings(mask: number, turns = 1): number {
  let m = mask;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

/** One try's puzzle: the board, how many moves it allows, and the work it was made with. */
export interface RelightPuzzle extends RelightBoard {
  /** The moves that undo the scramble: a known solution, so `limit` is always enough. Server only. */
  readonly solution: readonly RelightMove[];
  /** Its length, the puzzle's work: `limit = work + slack`. */
  readonly work: number;
}

/**
 * How deep a village tile is in its Hollow (coordinator decision 2026-10-22):
 * the square is the heart; a tile round the square with Hollow tiles on both
 * sides of it along the ring is inner, so a fuller Hollow is a harder one;
 * any other is the rim. (Every ring tile touches land outside, so "touches
 * outside" alone would make them all rim.) A tile off the ring, which today's
 * Hollows don't have, is inner unless it touches land outside.
 */
export function relightDepth(tile: Hex, square: Hex, village: readonly Hex[]): RelightDepth {
  if (hexEquals(tile, square)) return 'heart';
  const inside = new Set(village.map(hexKey));
  const around = new Set(hexNeighbors(square).map(hexKey));
  const near = hexNeighbors(tile);
  if (around.has(hexKey(tile))) {
    // Its two neighbours along the ring are the ones it shares with the square.
    const flanks = near.filter((h) => around.has(hexKey(h)));
    return flanks.every((h) => inside.has(hexKey(h))) ? 'inner' : 'rim';
  }
  return near.some((h) => !inside.has(hexKey(h))) ? 'rim' : 'inner';
}

/** A try's seed: every try (and so every reshuffle) is its own puzzle, the same on a rebuild. */
export function relightSeed(hollowSeed: Seed, tile: Hex, userId: string, attempt: number): Seed {
  return deriveSeed(hollowSeed, 'relight', tile.q, tile.r, userId, attempt);
}

/**
 * One Relight puzzle from a seed, solvable by construction: a solved board
 * scrambled by legal moves, so undoing the scramble is a solution of
 * `work` moves and `limit = work + slack` is always reachable. A board
 * whose work is under the tier's `minWork`, or that is lit already, is made
 * again.
 */
export function makeRelight(seed: Seed, tier: RelightTier): RelightPuzzle {
  for (let tryNo = 0; tryNo < TRIES; tryNo++) {
    const made = tryRelight(Rng.fromSeed(deriveSeed(seed, tryNo)), tier);
    if (made && made.work >= tier.minWork) return made;
  }
  throw new Error('makeRelight: no puzzle at this seed');
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return out;
}

const bitCount = (m: number) => DIRS.filter((d) => m & d.bit).length;

function tryRelight(rng: Rng, tier: RelightTier): RelightPuzzle | null {
  const n = tier.size;
  const at = (row: number, col: number) => row * n + col;
  const inside = (row: number, col: number) => row >= 0 && row < n && col >= 0 && col < n;
  const rowOf = (i: number) => Math.floor(i / n);
  // The heart sits on the bottom row, away from the corners.
  const heart = at(n - 1, rng.int(1, n - 2));
  // Echo shadows: never on the heart or right beside it.
  const shadows = new Set<number>();
  const nearHeart = (i: number) =>
    Math.abs(rowOf(i) - (n - 1)) + Math.abs((i % n) - (heart % n)) <= 1;
  while (shadows.size < tier.shadows) {
    const i = rng.int(0, n * n - 1);
    if (!nearHeart(i)) shadows.add(i);
  }

  // A random spanning tree over the open cells from the heart (randomised Prim).
  const inTree = new Set([heart]);
  const links = new Map<number, number>();
  const frontier: [number, number, (typeof DIRS)[number]][] = [];
  const addFrontier = (i: number) => {
    for (const d of DIRS) {
      const rr = rowOf(i) + d.dr;
      const cc = (i % n) + d.dc;
      if (!inside(rr, cc)) continue;
      const j = at(rr, cc);
      if (!shadows.has(j) && !inTree.has(j)) frontier.push([i, j, d]);
    }
  };
  addFrontier(heart);
  while (frontier.length > 0) {
    const [i, j, d] = frontier.splice(rng.int(0, frontier.length - 1), 1)[0] as [
      number,
      number,
      (typeof DIRS)[number],
    ];
    if (inTree.has(j)) continue;
    inTree.add(j);
    links.set(i, (links.get(i) ?? 0) | d.bit);
    links.set(j, (links.get(j) ?? 0) | d.back);
    addFrontier(j);
  }

  // Lanterns among the tree's leaves; then prune every other branch, so
  // the tree joins the heart to exactly the lanterns.
  const leaves = [...inTree].filter((i) => i !== heart && bitCount(links.get(i) ?? 0) === 1);
  if (leaves.length < tier.lanterns) return null;
  const lanterns = new Set(shuffled(rng, leaves).slice(0, tier.lanterns));
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const i of [...inTree]) {
      if (i === heart || lanterns.has(i)) continue;
      const m = links.get(i) ?? 0;
      if (bitCount(m) > 1) continue;
      inTree.delete(i);
      for (const d of DIRS) {
        if (!(m & d.bit)) continue;
        const j = at(rowOf(i) + d.dr, (i % n) + d.dc);
        links.set(j, (links.get(j) ?? 0) & ~d.back);
      }
      links.delete(i);
      pruned = true;
    }
  }

  // The solved board: tree cells carry their links; the rest are decoys,
  // and a few decoys become the empty slots wooden pieces slide into.
  const cells: RelightCell[] = [];
  const offTree: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (shadows.has(i)) cells.push({ kind: 'shadow', open: 0, loose: false });
    else if (i === heart) cells.push({ kind: 'heart', open: links.get(i) ?? 0, loose: false });
    else if (lanterns.has(i))
      cells.push({ kind: 'lantern', open: links.get(i) ?? 0, loose: false });
    else if (inTree.has(i)) cells.push({ kind: 'pipe', open: links.get(i) ?? 0, loose: false });
    else {
      cells.push({ kind: 'pipe', open: rng.pick(DECOYS), loose: false });
      offTree.push(i);
    }
  }
  const empties = shuffled(rng, offTree).slice(0, tier.empty);
  if (empties.length < tier.empty) return null;
  for (const i of empties) cells[i] = { kind: 'empty', open: 0, loose: false };
  // Wooden pieces are path pieces: they keep their turn, and only where they sit is scrambled.
  const treePipes = [...inTree].filter((i) => cells[i]?.kind === 'pipe');
  const loose = shuffled(rng, treePipes).slice(0, tier.loose);
  if (loose.length < tier.loose) return null;
  for (const i of loose) cells[i] = { ...(cells[i] as RelightCell), loose: true };
  const solved = cells.map((c) => ({ ...c }));
  if (!lightOf({ size: n, heart, cells: solved, limit: 0 }).won) return null;

  // Scramble with legal moves only: slide wooden pieces through the empty slots…
  const undoSlides: RelightMove[] = [];
  /** The last slide, as (slot it left, slot it filled): sliding it straight back would be wasted work. */
  let last: { from: number; into: number } | null = null;
  if (tier.empty > 0) {
    for (let s = 0; s < SLIDE_PICKS && undoSlides.length < tier.loose * SLIDES_PER_PIECE; s++) {
      const e = rng.pick(cells.flatMap((c, i) => (c.kind === 'empty' ? [i] : [])));
      const near = DIRS.flatMap((d) => {
        const rr = rowOf(e) + d.dr;
        const cc = (e % n) + d.dc;
        return inside(rr, cc) && cells[at(rr, cc)]?.loose ? [at(rr, cc)] : [];
      });
      const fresh = near.filter((j) => !(last && e === last.from && j === last.into));
      if (fresh.length === 0) continue;
      const j = rng.pick(fresh);
      const swap = cells[e] as RelightCell;
      cells[e] = cells[j] as RelightCell;
      cells[j] = swap;
      undoSlides.unshift({ type: 'slide', at: e, to: j });
      last = { from: j, into: e };
    }
  }
  // …and turn every other path piece and lantern at random.
  const turns: RelightMove[] = [];
  cells.forEach((c, i) => {
    if ((c.kind !== 'pipe' && c.kind !== 'lantern') || c.loose) return;
    const open = turnOpenings(c.open, rng.int(0, 3));
    cells[i] = { ...c, open };
    // The fewest turns that put a path piece back (decoys need none).
    if (!inTree.has(i)) return;
    const want = (solved[i] as RelightCell).open;
    for (let k = 0; turnOpenings(open, k) !== want; k++) turns.push({ type: 'turn', at: i });
  });

  const solution = [...undoSlides, ...turns];
  const board = { size: n, heart, cells, limit: solution.length + tier.slack };
  if (lightOf(board).won) return null;
  return { ...board, solution, work: solution.length };
}

/** What the light reaches. */
export interface RelightLight {
  /** Lit cells (none while an echo snuffs the light out). */
  readonly lit: ReadonlySet<number>;
  readonly litLanterns: number;
  readonly lanterns: number;
  /** The echo shadow the light touched, if any: the whole line is dark. */
  readonly spooked: number | null;
  readonly won: boolean;
}

const openingsOf = (c: RelightCell) => (c.kind === 'shadow' || c.kind === 'empty' ? 0 : c.open);

/** Where the light flows from the heart, and whether it lights every lantern without touching an echo. */
export function lightOf(board: RelightBoard): RelightLight {
  const n = board.size;
  const lit = new Set([board.heart]);
  const queue = [board.heart];
  let spooked: number | null = null;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] as number;
    const m = openingsOf(board.cells[i] as RelightCell);
    for (const d of DIRS) {
      if (!(m & d.bit)) continue;
      const rr = Math.floor(i / n) + d.dr;
      const cc = (i % n) + d.dc;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const j = rr * n + cc;
      const o = board.cells[j] as RelightCell;
      if (o.kind === 'shadow') {
        spooked ??= j;
        continue;
      }
      if (lit.has(j) || !(openingsOf(o) & d.back)) continue;
      lit.add(j);
      queue.push(j);
    }
  }
  const lanterns = board.cells.flatMap((c, i) => (c.kind === 'lantern' ? [i] : []));
  const litLanterns = spooked === null ? lanterns.filter((i) => lit.has(i)).length : 0;
  return {
    lit: spooked === null ? lit : new Set(),
    litLanterns,
    lanterns: lanterns.length,
    spooked,
    won: spooked === null && litLanterns === lanterns.length,
  };
}

/** The empty slots a wooden piece could slide into right now (beside it). */
export function slidesFrom(board: RelightBoard, at: number): number[] {
  const n = board.size;
  if (!board.cells[at]?.loose) return [];
  return DIRS.flatMap((d) => {
    const rr = Math.floor(at / n) + d.dr;
    const cc = (at % n) + d.dc;
    if (rr < 0 || rr >= n || cc < 0 || cc >= n) return [];
    return board.cells[rr * n + cc]?.kind === 'empty' ? [rr * n + cc] : [];
  });
}

/** One move: turn a fixed piece or lantern, or slide a wooden piece into the empty slot beside it. Null if it isn't legal. */
export function applyRelightMove<B extends RelightBoard>(board: B, move: RelightMove): B | null {
  const c = board.cells[move.at];
  if (!c) return null;
  const cells = [...board.cells];
  if (move.type === 'turn') {
    if ((c.kind !== 'pipe' && c.kind !== 'lantern') || c.loose) return null;
    cells[move.at] = { ...c, open: turnOpenings(c.open) };
    return { ...board, cells };
  }
  if (!slidesFrom(board, move.at).includes(move.to)) return null;
  cells[move.to] = c;
  cells[move.at] = board.cells[move.to] as RelightCell;
  return { ...board, cells };
}

export type RelightCheck =
  { ok: true } | { ok: false; why: 'too-many-moves' | 'illegal-move' | 'not-lit' };

/** What the server does with a try: replay every move on the rebuilt board, within the limit, and check the light. */
export function checkRelight(puzzle: RelightBoard, moves: readonly RelightMove[]): RelightCheck {
  if (moves.length > puzzle.limit) return { ok: false, why: 'too-many-moves' };
  let board: RelightBoard = puzzle;
  for (const move of moves) {
    const next = applyRelightMove(board, move);
    if (!next) return { ok: false, why: 'illegal-move' };
    board = next;
  }
  return lightOf(board).won ? { ok: true } : { ok: false, why: 'not-lit' };
}

/** The board as the client sees it: never the solution. */
export function relightBoard(puzzle: RelightPuzzle): RelightBoard {
  return { size: puzzle.size, heart: puzzle.heart, limit: puzzle.limit, cells: puzzle.cells };
}
