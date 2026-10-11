import type { WorldPoint } from '@heartpatch/shared';
import { seededRandom } from './explore-world.js';
import type { LandShape } from './land-config.js';

// The explore land's shape (#335 art reset): one height function over the
// whole land, world units, pure so it's unit-tested. The ground mesh, every
// prop, the Keeper's feet and the ground taps all read it, so nothing floats
// or sinks. Inside the tile it only rolls gently (little rises, a worn path);
// past the edge it rolls into hills that curve away like a hilltop meadow,
// so the far trees stand against the sky.

const SQRT3_2 = Math.sqrt(3) / 2;

/** A hash of two integers and a seed, in [0, 1). */
function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return (top + (bottom - top) * sz) * 2 - 1;
}

/** Two octaves of value noise, in about [-1, 1]. */
export function softNoise(x: number, z: number, seed: number): number {
  return (valueNoise(x, z, seed) * 2 + valueNoise(x * 2.1 + 17.3, z * 2.1 - 9.1, seed + 1)) / 3;
}

/**
 * The ground grid's warp: `t` in [-1, 1] across the land to `s` in [-1, 1]
 * across the grid (and the painted texture), `1 + warp` times finer in the
 * middle than at the rim. Odd and monotonic.
 */
export function warp(t: number, w: number): number {
  return (t * (1 + w)) / (1 + w * Math.abs(t));
}

/** The inverse of `warp`. */
export function unwarp(s: number, w: number): number {
  return s / (1 + w - w * Math.abs(s));
}

/**
 * How far out a world point is on the tile's hex (a hex norm): 0 in the
 * middle, 1 anywhere on the tile's edge, more outside it. The hex has its
 * corners at ±z, like `clampToTile`.
 */
export function hexReach(p: WorldPoint, size: number): number {
  let d = Math.abs(p.x);
  for (const a of [Math.PI / 3, (2 * Math.PI) / 3]) {
    d = Math.max(d, Math.abs(p.x * Math.cos(a) + p.z * Math.sin(a)));
  }
  return d / (SQRT3_2 * size);
}

export interface LandField {
  /** The ground's height under a world point. */
  height(x: number, z: number): number;
  /** The path's middle line: its x at a given z. */
  pathX(z: number): number;
  /** 1 on the path, fading to 0 at its edges (soft over `soft` world units). */
  pathMask(x: number, z: number, soft?: number): number;
  /** The little rises inside the tile (world points). */
  readonly rises: readonly WorldPoint[];
}

/**
 * The land for one tile (`seed` from the tile, so every device sees the same
 * land). `start` is where the Keeper starts (world units): the path runs
 * past it, so the first view is down a little trail.
 */
export function landField(
  shape: LandShape,
  seed: number,
  size: number,
  start: WorldPoint,
): LandField {
  const rand = seededRandom(seed);
  const phase = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const { sway, bend, width, sink } = shape.path;
  const wander = (z: number) =>
    sway * Math.sin(z * bend + phase) + 0.35 * sway * Math.sin(z * bend * 2.3 + phase2);
  // Beside the start, a little to one side, so the Keeper stands at the path's edge.
  const offset = start.x + width * 0.6 - wander(start.z);
  const pathX = (z: number) => wander(z) + offset;
  const slope = (z: number) => (pathX(z + 0.01) - pathX(z - 0.01)) / 0.02;

  const rises: WorldPoint[] = [];
  for (let i = 0; i < shape.rises.count; i++) {
    const angle = rand() * Math.PI * 2;
    const out = size * (0.3 + rand() * 0.35);
    rises.push({ x: Math.cos(angle) * out, z: Math.sin(angle) * out });
  }

  const pathMask = (x: number, z: number, soft = 0.25): number => {
    const across = Math.abs(x - pathX(z)) / Math.sqrt(1 + slope(z) ** 2);
    const half = width / 2;
    if (across <= half - soft) return 1;
    if (across >= half) return 0;
    const t = (half - across) / soft;
    return t * t * (3 - 2 * t);
  };

  const { bumps, ripples, edge, fall, hills } = shape;
  const twoW2 = 2 * shape.rises.width ** 2;
  const height = (x: number, z: number): number => {
    let h =
      bumps.height * softNoise(x * bumps.scale, z * bumps.scale, seed) +
      ripples.height * valueNoise(x * ripples.scale, z * ripples.scale, seed + 7);
    for (const r of rises) {
      h += shape.rises.height * Math.exp(-((x - r.x) ** 2 + (z - r.z) ** 2) / twoW2);
    }
    h -= sink * pathMask(x, z);
    const beyond = Math.hypot(x, z) - edge;
    if (beyond > 0) {
      const t = beyond / fall.length;
      h -= (fall.depth * t * t) / (1 + t * t);
      const grow = 1 - Math.exp(-((beyond / 6) ** 2));
      h += grow * hills.height * softNoise(x * hills.scale, z * hills.scale, seed + 13);
    }
    return h;
  };

  return { height, pathX, pathMask, rises };
}
