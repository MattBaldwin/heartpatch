import { hexToWorld, type Hex } from '@heartpatch/shared';
import { CHRISTMAS } from './map-config.js';

// Where the Patch Tree stands and where its ornaments hang (#37 2d). Pure
// (no Babylon), so it's unit-tested. The tree stands on the trading post the
// server picked, in front of the hut and to its left; its ornaments hang on
// the tiers' camera side in a low-discrepancy order, so the first few are
// already spread over the whole tree and every later one fills a gap (a
// bare tree, then sparse, then full by the star's count).

const T = CHRISTMAS.tree;

/** One ornament: where it hangs on the tree (model units, the tub's foot at 0), its colour and twinkle phase. */
export interface Ornament {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** An index into `CHRISTMAS.tree.ornamentColors`. */
  readonly color: number;
  /** 0–1: where in the twinkle it starts, so neighbours don't blink together. */
  readonly phase: number;
}

/** The golden ratio's fractional part: each step lands in the biggest gap left. */
const GOLDEN = 0.6180339887498949;

/** The lowest and highest an ornament hangs (model units): the bottom tier's skirt to under the star. */
const LOW = (T.tiers[0]?.y ?? 0) + 0.015;
const HIGH =
  (T.tiers[T.tiers.length - 1]?.y ?? 0) + (T.tiers[T.tiers.length - 1]?.height ?? 0) * 0.55;

/** How far round from the camera's side (−z) ornaments hang, each way (radians): the back stays bare. */
const ARC = Math.PI * 0.72; // TUNE

/** The tree's outer radius at height `y` (the widest tier there), or 0 above them all. */
export function radiusAt(y: number): number {
  let r = 0;
  for (const tier of T.tiers) {
    const k = (y - tier.y) / tier.height;
    if (k >= 0 && k <= 1) r = Math.max(r, tier.radius * (1 - k));
  }
  return r;
}

/** Ornaments drawn for a count: none for a bare tree, at most `ornamentCap`. */
export function shownOrnaments(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), T.ornamentCap);
}

/** The first `count` ornaments (up to the cap), each where it always hangs. */
export function ornamentLayout(count: number): Ornament[] {
  const n = shownOrnaments(count);
  const out: Ornament[] = [];
  for (let i = 0; i < n; i++) {
    // Height and angle from two different low-discrepancy steps.
    const h = ((i + 0.5) * GOLDEN) % 1;
    const s = ((i + 0.5) * (1 - GOLDEN) * 1.7) % 1;
    const y = LOW + (HIGH - LOW) * h;
    const a = -Math.PI / 2 + (s * 2 - 1) * ARC;
    // On the tier's skin, a little proud of it so it reads as hanging there.
    const r = radiusAt(y) * 0.92 + T.ornamentRadius * 0.4;
    out.push({
      x: Math.cos(a) * r,
      y,
      z: Math.sin(a) * r,
      color: i % T.ornamentColors.length,
      phase: (i * GOLDEN * 3.1) % 1,
    });
  }
  return out;
}

/** The tree's foot in the world: its post tile's middle, then `CHRISTMAS.tree.offset`. */
export function treeSpot(post: Hex, size: number): { x: number; z: number } {
  const c = hexToWorld(post, size);
  return { x: c.x + T.offset.x, z: c.z + T.offset.z };
}

/** The tree's highest point (the star's tip), model units. */
export const TREE_TOP = T.star.y + T.star.radius;

/** The tree's widest reach from its foot (the bottom tier, or the tub), model units. */
export const TREE_REACH = Math.max(T.tub.radius, ...T.tiers.map((t) => t.radius));

/**
 * The tree keeps off its tile's labels (owner decision 2026-11-27, item 1),
 * worked out as the map camera sees it (`pitch`, radians down from the
 * horizon, looking along +z) for a tile of `tileRadius` (pointy-top): its top
 * stays under the tile's back corner on screen, by `margin` (a share of the
 * tile's height there), where the post's flag sits; and it stays in the
 * tile's left half, clear of a tile mark's corner (top right). Orthographic;
 * the e2e test checks the same against the real flags at the frames' zooms.
 */
export function treeFits(pitch: number, tileRadius: number, margin = 0.1): boolean {
  const up = (y: number, z: number) => y * Math.cos(pitch) + z * Math.sin(pitch);
  const back = up(0, tileRadius);
  const front = up(0, -tileRadius);
  const top = up(TREE_TOP, T.offset.z + T.star.radius);
  const under = top <= back - (back - front) * margin;
  // Pointy-top: the tile spans ±cos 30° of its radius across.
  const half = tileRadius * Math.cos(Math.PI / 6);
  const right = (T.offset.x + TREE_REACH + half) / (2 * half);
  return under && right <= 0.5;
}
