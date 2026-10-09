import { hexKey, type PublicSearchSpot, type WorldPoint } from '@heartpatch/shared';
import {
  EXPLORE_CAMERA,
  EXPLORE_DECOR,
  EXPLORE_FADE,
  EXPLORE_VIEW,
  INTERACTION,
} from './explore-config.js';
import { roundedHexOutline } from '../map/hex-mesh.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { clampToTile, insideTile } from './explore-view.js';

// The explore view's world (#291, owner mockup 2026-10-08): colliders the
// Keeper slides along, which spot is in front of it, the follow camera and
// where the decor grows. Pure and tile-local (the tile is 2 across), so
// every case is unit-tested; the scene only draws what this works out.

/** A round obstacle: a search spot or a building. */
export interface Collider {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** A spot's collider radius, by kind. */
export function spotRadius(kind: string): number {
  return EXPLORE_VIEW.spotRadius[kind] ?? EXPLORE_VIEW.spotRadiusDefault;
}

/** Every spot (searched or not: the rock is still there) and building as a circle. */
export function collidersOf(
  spots: readonly Pick<PublicSearchSpot, 'kind' | 'x' | 'z'>[],
  buildings: readonly WorldPoint[],
): Collider[] {
  return [
    ...spots.map((s) => ({ x: s.x, z: s.z, r: spotRadius(s.kind) })),
    ...buildings.map((b) => ({ x: b.x, z: b.z, r: EXPLORE_VIEW.buildingRadius })),
  ];
}

/**
 * Moves from `from` towards `to`, never into a collider: a point that lands
 * inside one is pushed back out along its normal, which keeps the sideways
 * part of the step (the Keeper slides round a rock instead of stopping).
 * Kept inside the tile. If it still can't get clear (squeezed between two),
 * it stays where it was.
 */
export function slideMove(
  from: WorldPoint,
  to: WorldPoint,
  colliders: readonly Collider[],
  radius: number = EXPLORE_VIEW.keeperRadius,
): WorldPoint {
  let p = clampToTile(to);
  for (let pass = 0; pass < 4; pass++) {
    let pushed = false;
    for (const c of colliders) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      // Dead centre: push back the way it came.
      const nx = d > 1e-9 ? dx / d : from.x - c.x;
      const nz = d > 1e-9 ? dz / d : from.z - c.z;
      const n = Math.sqrt(nx * nx + nz * nz) || 1;
      p = clampToTile({ x: c.x + (nx / n) * (min + 1e-6), z: c.z + (nz / n) * (min + 1e-6) });
      pushed = true;
    }
    if (!pushed) return p;
  }
  return blocked(p, colliders, radius) ? from : p;
}

/** True when a Keeper at `p` overlaps a collider. */
export function blocked(
  p: WorldPoint,
  colliders: readonly Collider[],
  radius: number = EXPLORE_VIEW.keeperRadius,
): boolean {
  return colliders.some((c) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.r + radius) ** 2 - 1e-9);
}

/**
 * The nearest place to `p` where the Keeper stands clear of every collider
 * and inside the tile: `p` itself when it's free, else the first free point
 * on rings round it (the camera's side first). The Keeper's start can land
 * on a rock (#291), so it steps out before it's drawn.
 */
export function freePoint(
  p: WorldPoint,
  colliders: readonly Collider[],
  radius: number = EXPLORE_VIEW.keeperRadius,
): WorldPoint {
  const at = clampToTile(p);
  if (!blocked(at, colliders, radius)) return at;
  const step = radius * 0.5;
  for (let ring = 1; ring * step < 2; ring++) {
    const d = ring * step;
    const n = Math.max(8, Math.ceil((2 * Math.PI * d) / step));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const q = { x: at.x + Math.cos(a) * d, z: at.z + Math.sin(a) * d };
      if (insideTile(q) && !blocked(q, colliders, radius)) return q;
    }
  }
  return at;
}

/**
 * The heading that turns the Keeper's face (local −z) from `from` to `to`:
 * 0 faces −z (the camera), −π/2 faces +x. The shared `faceYaw`, so what the
 * logic thinks is in front is what shows.
 */
export function yawToward(from: WorldPoint, to: WorldPoint): number {
  return faceYaw(to.x - from.x, to.z - from.z);
}

/** The gap between the Keeper's edge and a spot's edge (negative: overlapping). */
export function gapTo(at: WorldPoint, spot: Pick<PublicSearchSpot, 'kind' | 'x' | 'z'>): number {
  const d = Math.sqrt((spot.x - at.x) ** 2 + (spot.z - at.z) ** 2);
  return d - spotRadius(spot.kind) - EXPLORE_VIEW.keeperRadius;
}

/** How far a spot is off the Keeper's heading, radians (0: dead ahead). */
export function offFacing(at: WorldPoint, yaw: number, spot: WorldPoint): number {
  const diff = yawToward(at, spot) - yaw;
  return Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
}

type FrontSpot = Pick<PublicSearchSpot, 'index' | 'kind' | 'x' | 'z' | 'done'>;

/**
 * The spot the action button offers (#291): the one the player tapped,
 * while it's in reach and not searched yet; else the unsearched spot in
 * reach that the Keeper faces (within the facing cone), the most nearly
 * ahead first. Null when nothing is in front.
 */
export function spotInFront<T extends FrontSpot>(
  at: WorldPoint,
  yaw: number,
  spots: readonly T[],
  aimed: number | null,
  reach: number = EXPLORE_VIEW.reach,
  cone: number = EXPLORE_VIEW.facingCone,
): T | null {
  const wanted = aimed === null ? undefined : spots.find((s) => s.index === aimed);
  if (wanted && !wanted.done && gapTo(at, wanted) <= reach) return wanted;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const s of spots) {
    if (s.done || gapTo(at, s) > reach) continue;
    const off = offFacing(at, yaw, s);
    if (off > cone) continue;
    // Nearly ahead beats a little closer.
    const score = off + Math.max(0, gapTo(at, s)) * EXPLORE_VIEW.frontWeight;
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** The spot a tap on the ground means: the nearest whose middle is within `pick`, or null. */
export function spotAtTap<T extends Pick<PublicSearchSpot, 'x' | 'z' | 'done'>>(
  point: WorldPoint,
  spots: readonly T[],
  pick: number = EXPLORE_VIEW.tapPick,
): T | null {
  let best: T | null = null;
  let bestD = pick * pick;
  for (const s of spots) {
    if (s.done) continue;
    const d = (s.x - point.x) ** 2 + (s.z - point.z) ** 2;
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where a walk to a spot stops: just outside its collider, well inside
 * reach, so the Keeper stands beside the rock, not on it. On the Keeper's
 * side if that's clear, else the nearest clear place round it (a neighbour
 * or the tile's edge can be in the way).
 */
export function besideSpot(
  from: WorldPoint,
  spot: Pick<PublicSearchSpot, 'kind' | 'x' | 'z'>,
  colliders: readonly Collider[] = [],
): WorldPoint {
  const dx = from.x - spot.x;
  const dz = from.z - spot.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const keep =
    spotRadius(spot.kind) + EXPLORE_VIEW.keeperRadius + EXPLORE_VIEW.reach * EXPLORE_VIEW.standOff;
  // Standing on it already: start from the camera's side.
  const base = d > 1e-9 ? Math.atan2(dz, dx) : -Math.PI / 2;
  let first: WorldPoint | null = null;
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.6, -2.6, Math.PI]) {
    const a = base + turn;
    const p = clampToTile({ x: spot.x + Math.cos(a) * keep, z: spot.z + Math.sin(a) * keep });
    first ??= p;
    if (!blocked(p, colliders) && gapTo(p, spot) <= EXPLORE_VIEW.reach) return p;
  }
  return first ?? clampToTile(from);
}

// ── The follow camera ─────────────────────────────────────────────────────

/**
 * Where the camera looks: a little ahead of the Keeper, kept inside the
 * tile's edge. While a tool is in use, between the Keeper and the spot, so
 * both stay in view above the gesture overlay.
 */
export function cameraGoal(
  keeper: WorldPoint,
  focus: WorldPoint | null = null,
  lit = false,
): WorldPoint {
  // The lantern walks: the camera keeps the Keeper and its light in view (board g).
  if (lit) {
    return clampToTile(
      { x: keeper.x, z: keeper.z + EXPLORE_CAMERA.lightLookAhead },
      EXPLORE_CAMERA.edgeMargin,
    );
  }
  const at = focus ? { x: (keeper.x + focus.x) / 2, z: (keeper.z + focus.z) / 2 } : keeper;
  return clampToTile({ x: at.x, z: at.z + EXPLORE_CAMERA.lookAhead }, EXPLORE_CAMERA.edgeMargin);
}

/**
 * The camera's tilt and distance for a screen's shape (width ÷ height): a
 * phone held upright looks flatter and closer, a tablet a little steeper;
 * in between blends them.
 */
export function cameraShot(aspect: number): { readonly pitch: number; readonly distance: number } {
  const { phone, tablet } = EXPLORE_CAMERA;
  const t = Math.min(1, Math.max(0, (aspect - phone.aspect) / (tablet.aspect - phone.aspect)));
  return {
    pitch: phone.pitch + (tablet.pitch - phone.pitch) * t,
    distance: phone.distance + (tablet.distance - phone.distance) * t,
  };
}

/**
 * The spots whose props stand between the camera and the Keeper (#291): in
 * front of it (towards the camera, which looks along +z), near its line,
 * and tall enough at that distance to cover its middle. `height` is a
 * prop's height and `middle` the Keeper's, both tile-local. Fills and
 * returns `out` (cleared first), so a caller can reuse one set.
 */
export function hidingSpots(
  keeper: WorldPoint,
  spots: readonly Pick<PublicSearchSpot, 'index' | 'kind' | 'x' | 'z'>[],
  pitch: number,
  height: (kind: string) => number,
  middle: number,
  out: Set<number> = new Set<number>(),
): Set<number> {
  out.clear();
  const slope = Math.tan(pitch);
  for (const s of spots) {
    const r = spotRadius(s.kind);
    const ahead = keeper.z - s.z; // towards the camera
    if (ahead <= 0) continue; // level with it or behind it: never in the way
    if (Math.abs(s.x - keeper.x) > r * 2 + EXPLORE_FADE.side) continue;
    // The line of sight to the Keeper's middle climbs `slope` per unit towards the camera.
    if (height(s.kind) <= middle + Math.max(0, ahead - r) * slope) continue;
    out.add(s.index);
  }
  return out;
}

export interface FollowCamera {
  /** Tile-local target. */
  readonly target: WorldPoint;
  /** Share of `EXPLORE_CAMERA.distance` (1, or `nudge` while a tool is in use). */
  readonly zoom: number;
}

/**
 * One frame of the follow: eases the target and zoom towards the goal and
 * snaps once close, so the camera settles and drawing can stop.
 */
export function followStep(
  camera: FollowCamera,
  goal: FollowCamera,
  dt: number,
  tau: number = EXPLORE_CAMERA.follow,
): FollowCamera {
  const k = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
  const x = camera.target.x + (goal.target.x - camera.target.x) * k;
  const z = camera.target.z + (goal.target.z - camera.target.z) * k;
  const zoom = camera.zoom + (goal.zoom - camera.zoom) * k;
  const settle = EXPLORE_CAMERA.settle;
  const there =
    Math.abs(goal.target.x - x) < settle &&
    Math.abs(goal.target.z - z) < settle &&
    Math.abs(goal.zoom - zoom) < settle;
  return there ? goal : { target: { x, z }, zoom };
}

/** True when the camera has reached its goal. */
export function cameraSettled(camera: FollowCamera, goal: FollowCamera): boolean {
  return (
    camera.target.x === goal.target.x &&
    camera.target.z === goal.target.z &&
    camera.zoom === goal.zoom
  );
}

// ── Decor ─────────────────────────────────────────────────────────────────

export type DecorKind = 'tufts' | 'pebbles' | 'flowers';

export interface DecorPlace {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
}

/** A small seeded RNG (mulberry32): the same tile grows the same decor everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The tile's seed: a hash of its key and a salt (FNV-1a). */
export function tileSeed(tile: { q: number; r: number }, salt: string): number {
  let h = 2166136261;
  for (const c of `${hexKey(tile)}:${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Where the grass tufts, pebbles and flowers grow (#291): scattered from the
 * tile's seed, kept clear of every collider and the Keeper's start (stepped
 * clear of the spots, as the screen does).
 */
export function decorPlaces(
  tile: { q: number; r: number },
  colliders: readonly Collider[],
  counts: Readonly<Record<DecorKind, number>> = EXPLORE_DECOR,
): Record<DecorKind, DecorPlace[]> {
  const out: Record<DecorKind, DecorPlace[]> = { tufts: [], pebbles: [], flowers: [] };
  const start = freePoint(EXPLORE_VIEW.start, colliders);
  const keepClear = [...colliders, { ...start, r: EXPLORE_VIEW.keeperRadius * 2 }];
  const { clearance, scale, spread } = EXPLORE_DECOR;
  for (const kind of ['tufts', 'pebbles', 'flowers'] as const) {
    const rand = seededRandom(tileSeed(tile, kind));
    const want = counts[kind];
    // A few tries each; a crowded tile just grows a little less.
    for (let tries = 0; out[kind].length < want && tries < want * 8; tries++) {
      const p = { x: (rand() * 2 - 1) * spread.x, z: (rand() * 2 - 1) * spread.z };
      const yaw = rand() * Math.PI * 2;
      const size = scale.min + rand() * (scale.max - scale.min);
      const inside = clampToTile(p, EXPLORE_DECOR.edgeMargin);
      if (inside.x !== p.x || inside.z !== p.z) continue;
      if (keepClear.some((c) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.r + clearance) ** 2)) {
        continue;
      }
      out[kind].push({ x: p.x, z: p.z, yaw, scale: size });
    }
  }
  return out;
}

// ── The lantern ───────────────────────────────────────────────────────────

/** The lantern reducer's stage: a square round the cave, in its own units. */
export const CAVE_STAGE = { width: 500, height: 500 } as const;

/** A tile-local point as a point on the cave's stage (screen-like: y grows towards the camera). */
export function toCaveStage(cave: WorldPoint, p: WorldPoint): { x: number; y: number } {
  const k = CAVE_STAGE.width / INTERACTION.caveArea;
  return {
    x: (p.x - cave.x) * k + CAVE_STAGE.width / 2,
    y: (cave.z - p.z) * k + CAVE_STAGE.height / 2,
  };
}

/** A point on the cave's stage as a tile-local point. */
export function fromCaveStage(cave: WorldPoint, s: { x: number; y: number }): WorldPoint {
  const k = CAVE_STAGE.width / INTERACTION.caveArea;
  return {
    x: cave.x + (s.x - CAVE_STAGE.width / 2) / k,
    z: cave.z - (s.y - CAVE_STAGE.height / 2) / k,
  };
}

/** The lantern's light on the ground, tile-local radius. */
export const LIGHT_REACH = INTERACTION.lightRadius * INTERACTION.caveArea;

/**
 * Where the lantern's glint hides (#291), on the cave's stage: the
 * reducer's pick, kept on the tile, and moved onto open ground if it fell
 * where no Keeper can stand within the light's reach of it.
 */
export function lanternGlint(
  cave: WorldPoint,
  picked: { x: number; y: number },
  colliders: readonly Collider[],
): { x: number; y: number } {
  const at = clampToTile(fromCaveStage(cave, picked));
  const stand = freePoint(at, colliders);
  const far = Math.hypot(stand.x - at.x, stand.z - at.z) > LIGHT_REACH * 0.8;
  return toCaveStage(cave, far ? stand : at);
}

// ── The tile's top ────────────────────────────────────────────────────────

/** The explore tile's lofted top (`loftRoundedHex`), tile-local across, map units up. */
export interface TileTop {
  /** The outline's corner-to-middle radius, tile-local (`TILE_FILL`). */
  readonly radius: number;
  /** Corner rounding, as a share of the radius, and segments per corner. */
  readonly corner: number;
  readonly segments: number;
  /** Height at the middle, and each ring's scale and height out to the rim (outermost last). */
  readonly centre: number;
  readonly rings: readonly { readonly scale: number; readonly y: number }[];
}

/**
 * The height of the tile's top under a tile-local point (#291), in the
 * profile's units: the same rounded outline and rings `loftRoundedHex`
 * lofts. Each band between two rings is a flat strip (two parallel edges),
 * so along a ray from the middle the height is linear in the ring scale and
 * this matches the mesh exactly. Things stand on it, so nothing floats over
 * the rim's bevel or sinks into the dome.
 */
export function tileSurface(top: TileTop): (p: WorldPoint) => number {
  const outline = roundedHexOutline(top.radius, top.radius * top.corner, top.segments);
  const n = outline.length;
  /** How far the outline is from the middle along a direction. */
  const reachAlong = (dx: number, dz: number): number => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = outline[i] ?? { x: 0, z: 0 };
      const b = outline[(i + 1) % n] ?? a;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const along = (a.x * ez - a.z * ex) / den;
      const on = (a.x * dz - a.z * dx) / den;
      if (along > 0 && on >= -1e-9 && on <= 1 + 1e-9) best = Math.min(best, along);
    }
    return best;
  };
  const rings = [{ scale: 0, y: top.centre }, ...top.rings];
  return (p) => {
    const d = Math.hypot(p.x, p.z);
    if (d < 1e-9) return top.centre;
    const s = d / reachAlong(p.x / d, p.z / d);
    for (let j = 1; j < rings.length; j++) {
      const inner = rings[j - 1] ?? rings[0];
      const outer = rings[j] ?? inner;
      if (s <= outer.scale) {
        const t = (s - inner.scale) / (outer.scale - inner.scale || 1);
        return inner.y + (outer.y - inner.y) * t;
      }
    }
    return rings[rings.length - 1]?.y ?? top.centre;
  };
}
