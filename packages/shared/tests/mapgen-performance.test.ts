import { describe, expect, it } from 'vitest';
import { GAME_DATA, generateMap } from '../src/index.js';

// Lives in tests/ because src/ may not touch timers or `performance`.
describe('generateMap performance', () => {
  it('generates a 4-player map (radius 12, 469 tiles) in well under 50 ms', () => {
    generateMap(GAME_DATA, { seed: 'warm-up', playerCount: 4 }); // warm up
    const runs = 10;
    const start = performance.now();
    for (let i = 1; i <= runs; i++) generateMap(GAME_DATA, { seed: `perf-${i}`, playerCount: 4 });
    expect((performance.now() - start) / runs).toBeLessThan(50);
  });

  it('generates a 6-player map (radius 16, 817 tiles) in well under 50 ms (#318)', () => {
    generateMap(GAME_DATA, { seed: 'warm-up', playerCount: 6 }); // warm up
    const runs = 10;
    const start = performance.now();
    for (let i = 1; i <= runs; i++) generateMap(GAME_DATA, { seed: `perf-${i}`, playerCount: 6 });
    expect((performance.now() - start) / runs).toBeLessThan(50);
  });
});
