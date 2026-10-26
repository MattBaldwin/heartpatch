import { backReach, type WorldPoint } from '@heartpatch/shared';
import { seededRandom } from './explore-world.js';
import type { LandBank, LandShape } from './land-config.js';

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

/**
 * How far towards the tile's two back edges (away from the camera) a world
 * point is: 0 at the middle, 1 on either back edge, more past them, negative
 * towards the camera. A bank's bands are read on it (`LandBank`).
 */
export function bankReach(p: WorldPoint, size: number): number {
  return backReach(p.x / size, p.z / size);
}

/** A spot on the land, world units: a bank shapes the ground under it by kind. */
export interface LandSpot {
  readonly x: number;
  readonly z: number;
  readonly kind: string;
}

/** A bank's jetty (`LandBank.jetty`), world units: its foot on the shore, the way it runs, its length. */
export interface Jetty {
  readonly x: number;
  readonly z: number;
  /** Its bearing, radians (the way out over the water). */
  readonly angle: number;
  readonly length: number;
}

/** A bank's water and shore (`LandShape.bank`), as the paint and the growth read them. */
export interface BankField {
  readonly level: number;
  /** 0 on the meadow, 1 on the shore's sand and pebbles (and under the water). */
  shore(x: number, z: number): number;
  /** The jetty, or null when every bearing is crowded by spots. */
  readonly jetty: Jetty | null;
}

export interface LandField {
  /** The ground's height under a world point. */
  height(x: number, z: number): number;
  /** Where the Keeper's feet stand: the ground, or a jetty's deck over it. */
  stand(x: number, z: number): number;
  /** The bank, when the shape has one. */
  readonly bank: BankField | null;
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
  spots: readonly LandSpot[] = [],
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
  const raw = (x: number, z: number): number => {
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

  if (!shape.bank) return { height: raw, stand: raw, bank: null, pathX, pathMask, rises };
  return { ...banked(shape.bank, raw, size, spots, edge), pathX, pathMask, rises };
}

const ease = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A bank's ground: the meadow (levelled so its middle is at 0, where the
 * river's layers are placed) eased down through the bank's bands, each spot
 * on the bank padded to its kind's height, and the jetty's deck to stand on.
 * Its dips below the middle ease off before they reach the water (`dry`), up
 * to where it falls away past `edge`.
 */
function banked(
  bank: LandBank,
  raw: (x: number, z: number) => number,
  size: number,
  spots: readonly LandSpot[],
  edge: number,
): Pick<LandField, 'height' | 'stand' | 'bank'> {
  const base = raw(0, 0);
  // Above the middle the meadow is as it rolls; below it, it eases (smoothly)
  // towards `dry` over the water and never past it.
  const sag = -(bank.level + bank.dry);
  const dry = (h: number, x: number, z: number): number => {
    if (h >= 0 || sag <= 0) return h;
    const eased = -sag * (1 - Math.exp(h / sag));
    return h + (eased - h) * (1 - ease(edge - 0.2, edge + 0.4, Math.hypot(x, z)));
  };
  const reach = (x: number, z: number) => bankReach({ x, z }, size);
  // Only spots on the bank are padded; one out on the meadow keeps the grass.
  const pads = spots.flatMap((s) => {
    const lift = bank.pads[s.kind];
    const on = ease(bank.shore - 0.05, bank.water, reach(s.x, s.z));
    return lift === undefined || on === 0 ? [] : [{ x: s.x, z: s.z, y: bank.level + lift, on }];
  });
  const height = (x: number, z: number): number => {
    let h = dry(raw(x, z) - base, x, z);
    const e = reach(x, z);
    if (e > bank.shore) {
      h += (bank.level - h) * ease(bank.shore, bank.water, e);
      h -= bank.floor * ease(bank.water, bank.bed, e);
      h -= (bank.bottom - bank.floor) * ease(bank.drop, bank.deep, e);
    }
    for (const p of pads) {
      const t = Math.hypot(x - p.x, z - p.z) / bank.padReach;
      if (t < 1) h += (p.y - h) * p.on * (1 - t * t) ** 2;
    }
    return h;
  };
  const jetty = jettyFor(bank, size, spots);
  const deck = bank.level + bank.jetty.deck;
  const half = bank.jetty.width / 2;
  const stand = (x: number, z: number): number => {
    const h = height(x, z);
    if (!jetty) return h;
    const dx = x - jetty.x;
    const dz = z - jetty.z;
    const along = dx * Math.cos(jetty.angle) + dz * Math.sin(jetty.angle);
    const aside = -dx * Math.sin(jetty.angle) + dz * Math.cos(jetty.angle);
    return along >= 0 && along <= jetty.length && Math.abs(aside) <= half ? Math.max(h, deck) : h;
  };
  const shore = (x: number, z: number): number =>
    Math.max(
      ease(bank.shore - 0.04, bank.water - 0.02, reach(x, z)),
      1 - ease(bank.level + 0.06, bank.level + 0.16, height(x, z)),
    );
  return { height, stand, bank: { level: bank.level, shore, jetty } };
}

/** The first of the bank's jetty bearings whose deck runs clear of every spot, footed at the waterline. */
function jettyFor(bank: LandBank, size: number, spots: readonly LandSpot[]): Jetty | null {
  const { bearings, clear, length } = bank.jetty;
  for (const deg of bearings) {
    const angle = (deg * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    // `bankReach` grows evenly along a ray from the middle: its foot is at the waterline.
    const per = bankReach({ x: dx, z: dz }, size);
    if (per <= 0) continue;
    const foot = bank.water / per;
    const free = spots.every((s) => {
      const along = Math.min(length, Math.max(0, (s.x - dx * foot) * dx + (s.z - dz * foot) * dz));
      return Math.hypot(s.x - dx * (foot + along), s.z - dz * (foot + along)) >= clear;
    });
    if (free) return { x: dx * foot, z: dz * foot, angle, length };
  }
  return null;
}
