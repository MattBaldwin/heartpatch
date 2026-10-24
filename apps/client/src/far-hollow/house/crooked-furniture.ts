import type { CrookedHouseView, CrookedRoom, CrookedThing } from '@heartpatch/shared';
import { CHEST_SIZE } from './crooked-bonus-kit.js';
import { chestPoint } from './crooked-bonus.js';
import { atticChestPoint, CROOKED_ATTIC } from './crooked-attic.js';
import { TOPPLED_YAW } from './crooked-kit.js';
import {
  CROOKED_WALK,
  crookedThings,
  tapGoal,
  tappedThing,
  thingPoint,
  walkStep,
  type FloorPoint,
  type WalkResult,
} from './crooked-plan.js';

// The Crooked House's furniture is solid (#651), pure so every case is
// unit-tested. Each prop has a footprint on the floor, a box from its kit
// shape (`crooked-kit.ts`), turned with it when it's knocked over. The
// Keeper is a circle; a step that would overlap a box is pushed back out of
// it by the nearer edge, so walking into furniture slides along it as the
// walls do. A tap-walk goes round furniture on a coarse grid, and a tap on
// furniture walks to the nearest spot the Keeper can stand. Rugs, the
// runner and small things a kid steps over stay walkable. A knocked-over
// thing is solid too, lying the way `TOPPLE_TURNS` keeps it out of doorways.

export const CROOKED_BODY = {
  /** The Keeper's body on the floor, a circle this wide (metres, at the house's size). */
  radius: 0.24, // TUNE
  /** Kept this much further off furniture than its drawn edge. */
  pad: 0.05, // TUNE
  /** A tap-walk's grid, metres a cell. */
  cell: 0.1, // TUNE
} as const;

/** How close the Keeper's middle comes to a footprint's edge. */
const CLEAR = CROOKED_BODY.radius + CROOKED_BODY.pad;
/** Floating-point slack: a point pushed to the edge counts as clear. */
const EPS = 1e-7;

/** A prop's footprint standing up, prop-local metres: west, south, east, north, and its height. */
export type PropExtent = readonly [x0: number, z0: number, x1: number, z1: number, h: number];

/**
 * Each kit prop's footprint, read off its shape in `crooked-kit.ts` (the
 * test checks every vertex is inside). `null` is walkable: flat things, a
 * wall's picture, the ceiling's mobile, the stairs, and small low things a
 * kid would step over (#651).
 */
export const PROP_FOOTPRINTS: Readonly<Record<string, PropExtent | null>> = {
  picture: null, // on the wall
  mirror: null, // on the wall
  armchair: [-0.6, -0.5, 0.6, 0.54, 1.15],
  chair: [-0.28, -0.28, 0.28, 0.3, 1.12],
  candelabra: [-0.36, -0.16, 0.36, 0.16, 1.68],
  clock: [-0.43, -0.33, 0.43, 0.31, 2.35],
  'flower-pots': [-0.61, -0.25, 0.57, 0.31, 0.87],
  'bird-cage': [-0.32, -0.32, 0.32, 0.32, 1.85],
  'watering-can': null, // small: stepped over
  lamp: [-0.28, -0.28, 0.28, 0.28, 1.65],
  runner: null, // a rug
  banister: null, // the stairs up
  tablecloth: [-1.49, -0.71, 1.49, 0.71, 0.88],
  'soup-bowl': null, // small: stepped over
  'book-pile': [-0.26, -0.26, 0.26, 0.26, 0.56],
  globe: [-0.36, -0.39, 0.36, 0.39, 1.29],
  'reading-lamps': [-0.6, -0.31, 0.6, 0.31, 1.3],
  stove: [-0.7, -0.41, 0.7, 0.41, 2.4],
  tap: [-0.7, -0.31, 0.7, 0.31, 1.4],
  pans: null, // flat: stepped over
  'cookie-jar': [-0.65, -0.36, 0.65, 0.36, 1.65],
  mop: [-0.21, -0.21, 0.21, 0.21, 1.6],
  bucket: [-0.27, -0.28, 0.27, 0.28, 0.82],
  'hat-stand': [-0.26, -0.25, 0.32, 0.25, 1.87],
  bed: [-0.8, -1.1, 0.8, 1.21, 1.14],
  drawers: [-0.55, -0.37, 0.55, 0.28, 0.99],
  'rocking-horse': [-0.65, -0.18, 0.65, 0.18, 1.15],
  blocks: [-0.35, -0.17, 0.35, 0.17, 0.64],
  mobile: null, // hangs from the ceiling
  'toy-chest': [-0.53, -0.33, 0.53, 0.33, 0.71],
  'piano-lid': [-0.81, -0.58, 0.81, 0.36, 1.16],
  'music-stands': [-0.26, -0.1, 0.26, 0.08, 1.33],
  'music-box': [-0.36, -0.26, 0.36, 0.26, 1.02],
  yarn: null, // small: stepped over
  'dress-form': [-0.3, -0.25, 0.3, 0.25, 1.66],
  'pin-cushion': [-0.45, -0.26, 0.45, 0.26, 1.07],
  'sewing-basket': [-0.34, -0.33, 0.34, 0.33, 0.72],
};

/** The kit's soft crate for a prop it doesn't know (`fallbackProp`). */
export const FALLBACK_FOOTPRINT: PropExtent = [-0.36, -0.31, 0.36, 0.31, 0.61];

/** The attic's lectern, round its spot (`CROOKED_ATTIC.lectern`). */
const LECTERN: PropExtent = [-0.36, -0.32, 0.36, 0.32, 1.05];

/**
 * A box on the floor: its origin, turned by `cos`/`sin` (a knocked-over
 * thing), and its extent in its own frame. World from local is
 * `x + lx·cos + lz·sin`, `z − lx·sin + lz·cos`, as the kit turns a mesh.
 */
export interface Footprint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly cos: number;
  readonly sin: number;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

const box = (id: string, at: FloorPoint, e: PropExtent, yaw = 0): Footprint => ({
  id,
  x: at.x,
  z: at.z,
  cos: Math.cos(yaw),
  sin: Math.sin(yaw),
  x0: e[0],
  z0: e[1],
  x1: e[2],
  z1: e[3],
});

/** A knocked-over thing lies on its side: its height runs out west, then it's turned (`prop`). */
const toppled = (e: PropExtent): PropExtent => [-e[4], e[1], 0, e[3], e[4]];

/** The prop's footprint, or null for a walkable one. */
const extentOf = (thing: CrookedThing): PropExtent | null =>
  thing.prop in PROP_FOOTPRINTS ? (PROP_FOOTPRINTS[thing.prop] ?? null) : FALLBACK_FOOTPRINT;

/**
 * Which way a knocked-over thing lies, by its id, where the kit's
 * `TOPPLED_YAW` would put it across a doorway or wall in a neighbour (the
 * flood-fill test finds those). The kit draws it so (`prop`), so the walk and
 * the picture agree.
 */
export const TOPPLE_TURNS: Readonly<Record<string, number>> = {
  // TUNE: mirrored, so the Dining Room's kitchen door and the Landing's nursery door stay clear.
  'chair-3': -TOPPLED_YAW,
  'hat-stand': -TOPPLED_YAW,
};

/** The turn round the floor a knocked-over thing lies at. */
export const toppledYaw = (thing: Pick<CrookedThing, 'id'>): number =>
  TOPPLE_TURNS[thing.id] ?? TOPPLED_YAW;

/** Built once per room and per set of fixed things (a fix stands a toppled thing up). */
const CACHE = new Map<string, { fixed: readonly string[] | undefined; list: Footprint[] }>();

/** The solid things in a room as it stands now: its props, its lamp, and its chest. */
export function roomFootprints(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms'>,
): readonly Footprint[] {
  const fixed = view.rooms.find((r) => r.id === room.id)?.fixed;
  const hit = CACHE.get(room.id);
  if (hit && hit.fixed === fixed) return hit.list;
  const list: Footprint[] = [];
  const crooked = new Set(crookedThings(room, view).map((t) => t.id));
  for (const thing of room.things) {
    const e = extentOf(thing);
    if (!e) continue;
    const at = thingPoint(room, thing);
    // A tilted thing (straighten) keeps its standing footprint; its lean is above the Keeper's knees.
    if (thing.kind === 'lift' && crooked.has(thing.id)) {
      list.push(box(thing.id, at, toppled(e), toppledYaw(thing)));
    } else list.push(box(thing.id, at, e));
  }
  // The room's own lamp, unless a crooked thing is its lamp (`roomParts`).
  const lamp = PROP_FOOTPRINTS['lamp'];
  if (room.lamp && lamp && !room.things.some((t) => t.prop === 'lamp')) {
    list.push(box('lamp', { x: room.box.x + room.lamp[0], z: room.box.z + room.lamp[1] }, lamp));
  }
  if (room.kind === 'bonus') {
    const { w, d } = CHEST_SIZE;
    list.push(box('chest', chestPoint(room), [-w / 2, -d / 2, w / 2, d / 2, CHEST_SIZE.h]));
  }
  if (room.kind === 'attic') {
    const { x, z } = CROOKED_ATTIC.half;
    list.push(box('attic-chest', atticChestPoint(room), [-x, -z, x, z, 1]));
    const [lx, lz] = CROOKED_ATTIC.lectern;
    list.push(box('lectern', { x: room.box.x + lx, z: room.box.z + lz }, LECTERN));
  }
  CACHE.set(room.id, { fixed, list });
  return list;
}

/** Whether a circle of `r` at `p` overlaps the footprint. */
function overlaps(f: Footprint, px: number, pz: number, r: number): boolean {
  const dx = px - f.x;
  const dz = pz - f.z;
  const lx = dx * f.cos - dz * f.sin;
  const lz = dx * f.sin + dz * f.cos;
  const ex = lx - Math.min(f.x1, Math.max(f.x0, lx));
  const ez = lz - Math.min(f.z1, Math.max(f.z0, lz));
  return ex * ex + ez * ez < (r - EPS) * (r - EPS);
}

/** Whether the Keeper standing at `p` would overlap any of the footprints. */
export function blocked(list: readonly Footprint[], p: FloorPoint): boolean {
  for (const f of list) if (overlaps(f, p.x, p.z, CLEAR)) return true;
  return false;
}

/** Where `push` moves a point to, without allocating each frame. */
const OUT = { x: 0, z: 0 };

/** Pushes `OUT` out of the footprint by the nearer edge; whether it moved. */
function push(f: Footprint): boolean {
  if (!overlaps(f, OUT.x, OUT.z, CLEAR)) return false;
  const dx = OUT.x - f.x;
  const dz = OUT.z - f.z;
  const lx = dx * f.cos - dz * f.sin;
  const lz = dx * f.sin + dz * f.cos;
  const cx = Math.min(f.x1, Math.max(f.x0, lx));
  const cz = Math.min(f.z1, Math.max(f.z0, lz));
  const ex = lx - cx;
  const ez = lz - cz;
  const d = Math.hypot(ex, ez);
  let nx = lx;
  let nz = lz;
  if (d > EPS) {
    // Outside the box but too close: straight out from its nearest point.
    nx = cx + (ex / d) * CLEAR;
    nz = cz + (ez / d) * CLEAR;
  } else {
    // Inside it: out by the nearest side.
    const w = lx - f.x0;
    const e = f.x1 - lx;
    const s = lz - f.z0;
    const n = f.z1 - lz;
    const m = Math.min(w, e, s, n);
    if (m === s) nz = f.z0 - CLEAR;
    else if (m === n) nz = f.z1 + CLEAR;
    else if (m === w) nx = f.x0 - CLEAR;
    else nx = f.x1 + CLEAR;
  }
  OUT.x = f.x + nx * f.cos + nz * f.sin;
  OUT.z = f.z - nx * f.sin + nz * f.cos;
  return true;
}

/**
 * One step of the walk: the walls and doors' step (`walkStep`), then out of
 * any furniture by its nearer edge, so a step into it slides along it. A
 * step that can't get clear (a corner between furniture and a wall) stays at
 * `from`. The walk compares this point, so a walk into furniture stops
 * beside it instead of pressing on every frame.
 */
export function houseStep(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms' | 'unlocked' | 'bonusOpen' | 'keys'>,
  from: FloorPoint,
  to: FloorPoint,
): WalkResult {
  const list = roomFootprints(room, view);
  const first = walkStep(room, view, to);
  OUT.x = first.at.x;
  OUT.z = first.at.z;
  let moved = false;
  for (let i = 0; i < 3; i++) {
    let any = false;
    for (const f of list) if (push(f)) any = true;
    if (!any) break;
    moved = true;
  }
  if (!moved) return first;
  const again = walkStep(room, view, { x: OUT.x, z: OUT.z });
  // Still in something (wedged against a wall): stay put, unless I was already stuck in it.
  if (blocked(list, again.at) && !blocked(list, from)) {
    return { at: from, crossed: null, bumped: first.bumped };
  }
  return { at: again.at, crossed: again.crossed, bumped: first.bumped ?? again.bumped };
}

/** A tap-walk's grid over a room: cells `CROOKED_BODY.cell` apart, inside the walls' margin. */
interface Grid {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly free: Uint8Array;
}

function gridOf(room: CrookedRoom, list: readonly Footprint[]): Grid {
  const { x, z, w, d } = room.box;
  const m = CROOKED_WALK.margin;
  const c = CROOKED_BODY.cell;
  const nx = Math.max(1, Math.floor((w - 2 * m) / c) + 1);
  const nz = Math.max(1, Math.floor((d - 2 * m) / c) + 1);
  // Centred, so the room's middle line is on the grid.
  const x0 = x - ((nx - 1) * c) / 2;
  const z0 = z - ((nz - 1) * c) / 2;
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      free[j * nx + i] = blocked(list, { x: x0 + i * c, z: z0 + j * c }) ? 0 : 1;
    }
  }
  return { x0, z0, nx, nz, free };
}

const cellPoint = (g: Grid, k: number): FloorPoint => ({
  x: g.x0 + (k % g.nx) * CROOKED_BODY.cell,
  z: g.z0 + Math.floor(k / g.nx) * CROOKED_BODY.cell,
});

function cellAt(g: Grid, p: FloorPoint): number {
  const c = CROOKED_BODY.cell;
  const i = Math.min(g.nx - 1, Math.max(0, Math.round((p.x - g.x0) / c)));
  const j = Math.min(g.nz - 1, Math.max(0, Math.round((p.z - g.z0) / c)));
  return j * g.nx + i;
}

/** Whether the Keeper can walk straight from `a` to `b` without touching furniture. */
function clearLine(list: readonly Footprint[], a: FloorPoint, b: FloorPoint): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CROOKED_BODY.cell / 2));
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    if (blocked(list, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * The way from `from` to `goal` round the room's furniture, as points to walk
 * through in turn (the last is the goal). A goal inside furniture, or one the
 * Keeper can't get to, becomes the nearest spot it can. A goal past the
 * walls (a doorway) is kept as the last point, so the walls' step takes it
 * through, as before. Built on a tap, never per frame.
 */
export function walkPath(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms'>,
  from: FloorPoint,
  goal: FloorPoint,
): FloorPoint[] {
  const list = roomFootprints(room, view);
  if (clearLine(list, from, goal)) return [goal];
  const g = gridOf(room, list);
  const start = cellAt(g, from);
  const prev = new Int32Array(g.nx * g.nz).fill(-1);
  const queue = new Int32Array(g.nx * g.nz);
  prev[start] = start;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  const want = cellAt(g, goal);
  let best = start;
  let bestD = Infinity;
  while (head < tail) {
    const k = queue[head++] ?? 0;
    // Nearest to the goal; on a tie, the one nearer the Keeper (found first).
    const p = cellPoint(g, k);
    const dist = Math.hypot(p.x - goal.x, p.z - goal.z);
    if (dist < bestD - 0.02) {
      best = k;
      bestD = dist;
    }
    const i = k % g.nx;
    const j = Math.floor(k / g.nx);
    for (const [di, dj] of STEPS) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
      const n = b * g.nx + a;
      if (prev[n] !== -1 || g.free[n] !== 1) continue;
      // A diagonal never cuts a corner.
      if (di !== 0 && dj !== 0 && (g.free[j * g.nx + a] !== 1 || g.free[b * g.nx + i] !== 1)) {
        continue;
      }
      prev[n] = k;
      queue[tail++] = n;
    }
  }
  const reached = prev[want] !== -1 && g.free[want] === 1 && !blocked(list, goal);
  const end = reached ? want : best;
  const cells: FloorPoint[] = [];
  for (let k = end; k !== start; k = prev[k] ?? start) cells.unshift(cellPoint(g, k));
  if (reached) cells.push(goal);
  if (cells.length === 0) return [from];
  // Straighten it: from each point, on to the furthest one in a clear line.
  const path: FloorPoint[] = [];
  let at = from;
  let next = 0;
  while (next < cells.length) {
    let far = next;
    for (let t = cells.length - 1; t > next; t--) {
      const c = cells[t];
      if (c && clearLine(list, at, c)) {
        far = t;
        break;
      }
    }
    const c = cells[far];
    if (!c) break;
    path.push(c);
    at = c;
    next = far + 1;
  }
  return path;
}

/**
 * A tap on the floor at `p`, as `tapGoal` picks it, then the way there round
 * the furniture. A crooked thing whose side spot is inside furniture (the
 * table) walks to the nearest spot beside its middle instead, in reach.
 */
export function tapWalk(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms'>,
  keeper: FloorPoint,
  p: FloorPoint,
): FloorPoint[] {
  let goal = tapGoal(room, view, keeper, p);
  const thing = tappedThing(room, view, p);
  if (thing && blocked(roomFootprints(room, view), goal)) goal = thingPoint(room, thing);
  return walkPath(room, view, keeper, goal);
}

/**
 * Where the Keeper may stand nearest `p` (a room's start, a door's arrival,
 * the last lit room after a catch): `p` itself unless furniture is there.
 */
export function settle(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms'>,
  p: FloorPoint,
): FloorPoint {
  const list = roomFootprints(room, view);
  if (!blocked(list, p)) return p;
  const g = gridOf(room, list);
  let best: FloorPoint = p;
  let bestD = Infinity;
  for (let k = 0; k < g.free.length; k++) {
    if (g.free[k] !== 1) continue;
    const c = cellPoint(g, k);
    const dist = Math.hypot(c.x - p.x, c.z - p.z);
    if (dist < bestD) {
      best = c;
      bestD = dist;
    }
  }
  return best;
}
