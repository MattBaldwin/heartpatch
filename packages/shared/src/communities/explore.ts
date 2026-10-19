import type { WorldPoint } from '../hex/index.js';
import { Rng, deriveSeed, type Seed } from '../rng/index.js';

// Exploring a grey village tile (#306 2a). Pure: the server fills
// `ExploreTileResponse.community` with these, and the client draws the same
// numbers, so two devices agree.

/** How much colour today's searches brought back: the share of spots searched, 0–100. */
export function exploreJoy(progress: { searched: number; total: number }): number {
  if (progress.total <= 0) return 0;
  return Math.round((Math.min(progress.searched, progress.total) * 100) / progress.total);
}

/** How far an echo's loop sits from the tile's middle at most, tile-local (the corner is 1 away). */
const ECHO_REACH = 0.55;
/** An echo's loop keeps this far from every search spot, tile-local, so it never hides one. */
const ECHO_GAP = 0.2;
const ECHO_TRIES = 40;

/**
 * Where each of a tile's `count` Hollow echoes drifts (its loop's middle,
 * tile-local), from the village's secret seed and the tile: the same for
 * everyone, and never on top of a spot. Echoes are client feel only (plan
 * v3): the server never tracks the Keeper on a tile.
 */
export function placeEchoes(
  seed: Seed,
  tile: { q: number; r: number },
  spots: readonly WorldPoint[],
  count: number,
): WorldPoint[] {
  const rng = Rng.fromSeed(deriveSeed(seed, 'echo', tile.q, tile.r));
  const echoes: WorldPoint[] = [];
  const clear = (x: number, z: number, gap: number) =>
    [...spots, ...echoes].every((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) >= gap * gap);
  for (let i = 0; i < count; i++) {
    let best: WorldPoint | null = null;
    for (let attempt = 0; attempt < ECHO_TRIES && !best; attempt++) {
      const x = round((rng.next() * 2 - 1) * ECHO_REACH);
      const z = round((rng.next() * 2 - 1) * ECHO_REACH);
      if (x * x + z * z <= ECHO_REACH * ECHO_REACH && clear(x, z, ECHO_GAP)) best = { x, z };
    }
    // A crowded tile: the far middle, where the camera looks first.
    echoes.push(best ?? { x: 0, z: round(ECHO_REACH / 2) });
  }
  return echoes;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
