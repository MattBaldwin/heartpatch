/**
 * TEST FIXTURE ONLY. A tiny deterministic stand-in for the shared seeded RNG
 * (issue #11) so map generation can be tested before it lands. Never shipped.
 */
import type { MapRng } from '../../src/mapgen/index.js';

/** mulberry32 over a numeric seed: good enough to vary maps in tests. */
export function stubRng(seed: number): MapRng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
  };
}
