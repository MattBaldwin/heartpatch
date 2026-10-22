import { describe, expect, it } from 'vitest';
import { MEMORY_PUZZLES } from '../data/memory-puzzles.js';
import { memoryPuzzle, puzzleSkinFor, puzzleSolvedBy } from './puzzle.js';

/** Squared distance (the shared code keeps clear of `Math.hypot`, tech spec §8). */
const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

describe('puzzleSkinFor (#306 PR 2b)', () => {
  it('dresses each terrain in its own skin, and the rest in the default', () => {
    expect(puzzleSkinFor('meadow', MEMORY_PUZZLES).id).toBe('music-box');
    expect(puzzleSkinFor('forest', MEMORY_PUZZLES).id).toBe('mural');
    expect(puzzleSkinFor('hills', MEMORY_PUZZLES).id).toBe('fountain');
    expect(puzzleSkinFor('somewhere-new', MEMORY_PUZZLES).id).toBe(MEMORY_PUZZLES.defaultSkin);
  });
});

describe('memoryPuzzle (#306 PR 2b)', () => {
  const tile = { q: 2, r: -1, terrain: 'meadow' };
  const spots = [
    { x: 0, z: 0 },
    { x: 0.3, z: 0.2 },
    { x: -0.3, z: -0.3 },
    { x: 0.35, z: -0.3 },
  ];
  const echoes = [{ x: -0.2, z: 0.3 }];

  it('is the same for everyone, and differs from tile to tile', () => {
    const a = memoryPuzzle('village-seed', tile, spots, echoes, MEMORY_PUZZLES);
    expect(memoryPuzzle('village-seed', tile, spots, echoes, MEMORY_PUZZLES)).toEqual(a);
    const others = [
      memoryPuzzle('village-seed', { ...tile, q: 3 }, spots, echoes, MEMORY_PUZZLES),
      memoryPuzzle('other-seed', tile, spots, echoes, MEMORY_PUZZLES),
    ];
    for (const b of others) expect({ ...b }).not.toEqual({ ...a });
  });

  it('puts every one of its skin pieces back, each once, in a shuffled order', () => {
    const pieces = MEMORY_PUZZLES.skins[0]?.pieces.map((p) => p.id).sort();
    const orders = new Set<string>();
    for (let q = 0; q < 24; q++) {
      const p = memoryPuzzle('village-seed', { ...tile, q }, spots, echoes, MEMORY_PUZZLES);
      expect(p.skin).toBe('music-box');
      expect([...p.order].sort()).toEqual(pieces);
      orders.add(p.order.join());
    }
    // Not always the data's own order: 24 tiles give many orders.
    expect(orders.size).toBeGreaterThan(6);
  });

  it('stands clear of the spots and the echoes, inside the tile', () => {
    for (let q = 0; q < 40; q++) {
      const p = memoryPuzzle(`seed-${String(q)}`, { ...tile, q }, spots, echoes, MEMORY_PUZZLES);
      expect(d2(p, { x: 0, z: 0 })).toBeLessThanOrEqual(0.6 * 0.6 + 1e-9);
      for (const s of spots) expect(d2(p, s)).toBeGreaterThanOrEqual(0.26 * 0.26 - 1e-6);
      for (const e of echoes) expect(d2(p, e)).toBeGreaterThanOrEqual(0.34 * 0.34 - 1e-6);
    }
  });

  it('still finds somewhere on a crowded tile', () => {
    const crowded = Array.from({ length: 49 }, (_, i) => ({
      x: ((i % 7) - 3) * 0.15,
      z: (Math.floor(i / 7) - 3) * 0.15,
    }));
    const p = memoryPuzzle('village-seed', tile, crowded, echoes, MEMORY_PUZZLES);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(d2(p, { x: 0, z: 0 })).toBeLessThanOrEqual(0.6 * 0.6);
  });
});

describe('puzzleSolvedBy (#306 PR 2b)', () => {
  it('takes only the puzzle’s own order, piece for piece', () => {
    const puzzle = { order: ['bell', 'drum', 'horn', 'fiddle'] };
    expect(puzzleSolvedBy(puzzle, ['bell', 'drum', 'horn', 'fiddle'])).toBe(true);
    expect(puzzleSolvedBy(puzzle, ['drum', 'bell', 'horn', 'fiddle'])).toBe(false);
    expect(puzzleSolvedBy(puzzle, ['bell', 'drum', 'horn'])).toBe(false);
    expect(puzzleSolvedBy(puzzle, ['bell', 'drum', 'horn', 'fiddle', 'bell'])).toBe(false);
  });
});
