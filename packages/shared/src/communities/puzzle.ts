import type { WorldPoint } from '../hex/index.js';
import type { MemoryPuzzleRules, PuzzleSkin } from '../schemas/data/memory-puzzles.js';
import { Rng, deriveSeed, type Seed } from '../rng/index.js';

// A grey village tile's memory puzzle (#306 PR 2b). Pure: the server fills
// `HollowedExplore.puzzle` with these from the village's secret seed and
// checks a solve against the same order, so the card a kid saw and the
// server's answer never disagree.

/** The skin a terrain's puzzle wears (`MEMORY_PUZZLES`). */
export function puzzleSkinFor(terrain: string, rules: MemoryPuzzleRules): PuzzleSkin {
  const skin =
    rules.skins.find((s) => s.terrains.includes(terrain)) ??
    rules.skins.find((s) => s.id === rules.defaultSkin) ??
    rules.skins[0];
  if (!skin) throw new Error('MEMORY_PUZZLES has no skins');
  return skin;
}

/** A tile's puzzle: its skin, the order its pieces go back in, and where it stands (tile-local). */
export interface MemoryPuzzle {
  readonly skin: string;
  readonly order: readonly string[];
  readonly x: number;
  readonly z: number;
}

/** How far the broken thing stands from the tile's middle at most, tile-local (a corner is 1 away). */
const PUZZLE_REACH = 0.6;
/** It keeps this far from every search spot, tile-local, so the Keeper can walk round both. */
const SPOT_GAP = 0.26;
/** And this far from every echo's loop, so solving it isn't one spook after another. */
const ECHO_GAP = 0.34;
const TRIES = 120;

/**
 * The memory puzzle of a grey village tile, from the village's secret seed
 * and the tile: the same for everyone. Its order is a shuffle of its skin's
 * pieces; it stands clear of the spots and the echoes.
 */
export function memoryPuzzle(
  seed: Seed,
  tile: { q: number; r: number; terrain: string },
  spots: readonly WorldPoint[],
  echoes: readonly WorldPoint[],
  rules: MemoryPuzzleRules,
): MemoryPuzzle {
  const rng = Rng.fromSeed(deriveSeed(seed, 'puzzle', tile.q, tile.r));
  const skin = puzzleSkinFor(tile.terrain, rules);
  // Fisher–Yates on the seeded roll.
  const order = skin.pieces.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = order[i] as string;
    order[i] = order[j] as string;
    order[j] = swap;
  }
  const clear = (x: number, z: number, from: readonly WorldPoint[], gap: number) =>
    from.every((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) >= gap * gap);
  let best: WorldPoint | null = null;
  for (let attempt = 0; attempt < TRIES && !best; attempt++) {
    const x = round((rng.next() * 2 - 1) * PUZZLE_REACH);
    const z = round((rng.next() * 2 - 1) * PUZZLE_REACH);
    if (
      x * x + z * z <= PUZZLE_REACH * PUZZLE_REACH &&
      clear(x, z, spots, SPOT_GAP) &&
      clear(x, z, echoes, ECHO_GAP)
    ) {
      best = { x, z };
    }
  }
  // A crowded tile: the clearest of a few places round the middle.
  const at = best ?? roomiest(spots, echoes);
  return { skin: skin.id, order, x: at.x, z: at.z };
}

/** Is `order` the puzzle's own, piece for piece? */
export function puzzleSolvedBy(puzzle: Pick<MemoryPuzzle, 'order'>, order: readonly string[]) {
  return order.length === puzzle.order.length && order.every((id, i) => puzzle.order[i] === id);
}

/** Twelve places round the middle (unit length: the six hex directions and between them), as constants (tech spec §8). */
const AROUND: readonly WorldPoint[] = [
  { x: 1, z: 0 },
  { x: 0.866, z: 0.5 },
  { x: 0.5, z: 0.866 },
  { x: 0, z: 1 },
  { x: -0.5, z: 0.866 },
  { x: -0.866, z: 0.5 },
  { x: -1, z: 0 },
  { x: -0.866, z: -0.5 },
  { x: -0.5, z: -0.866 },
  { x: 0, z: -1 },
  { x: 0.5, z: -0.866 },
  { x: 0.866, z: -0.5 },
];

/** Of a ring of places round the middle, the one furthest from everything. */
function roomiest(spots: readonly WorldPoint[], echoes: readonly WorldPoint[]): WorldPoint {
  const all = [...spots, ...echoes];
  let best = { x: 0, z: round(PUZZLE_REACH * 0.6) };
  let room = -1;
  for (const u of AROUND) {
    const p = { x: round(u.x * PUZZLE_REACH * 0.7), z: round(u.z * PUZZLE_REACH * 0.7) };
    const nearest = all.reduce(
      (m, s) => Math.min(m, (s.x - p.x) * (s.x - p.x) + (s.z - p.z) * (s.z - p.z)),
      Infinity,
    );
    if (nearest > room) {
      room = nearest;
      best = p;
    }
  }
  return best;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
