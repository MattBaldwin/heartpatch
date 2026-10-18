import { HOUSE_GRID, HOUSE_GROWN, HOUSE_KID } from './house-config.js';
import type { RoomBox, WallRun } from './house-layout.js';

/*
 * The Keeper walks about inside the house (#381 W1, the approved walk
 * mockup). Pure numbers: the walkable floor (every room's floor kept clear
 * of its walls, a strip through each inside doorway, the Heart Hall's
 * gallery and the stairs up to it), the furniture the Keeper walks round,
 * the slide along walls, and the follow camera that stays in the Keeper's
 * room so only that room's front wall ever fades.
 *
 * A walk frame allocates nothing: the Keeper's spot and the camera's pose
 * are small objects updated in place, like the explore hop's.
 */

export const HOUSE_WALK = {
  /** Metres a second at full push. */
  speed: 1.5, // TUNE
  /** The Keeper's footprint, metres: it keeps this far from walls and furniture. */
  radius: 0.28, // TUNE
  /** Furniture lower than this is walked over (rugs, mats). */
  stepOver: 0.15, // TUNE
  /** A merged piece bigger than this across the floor (beams, bunting, the gallery) never blocks, m². */
  wideIgnore: 6, // TUNE
  /** How far a floor may be from the Keeper's height and still be stepped onto, metres. */
  floorReach: 0.45, // TUNE
  /** How far the stairs' height may be from the Keeper's and still be stepped onto, metres. */
  rampReach: 0.6, // TUNE
  /** The camera's eye above the Keeper's floor: kid height, a little over its head. */
  eyeHeight: 1.7, // TUNE
  /** How far behind the Keeper the camera stands, metres. */
  back: 3.4, // TUNE
  /** The camera never turns more than this from looking into the house, degrees. */
  maxYaw: 28, // TUNE
  /** It turns this share of the way to the Keeper's heading (up to `maxYaw`). */
  turnShare: 0.5, // TUNE
  /** Heading further round than this (toward the camera), it looks straight in, radians. */
  turnAway: 1.9, // TUNE
  /** It looks at about the Keeper's chest... */
  lookHeight: 0.55, // TUNE
  /** ...this far ahead of it, metres. */
  lookAhead: 1.2, // TUNE
  /** The camera's eye and what it looks at stay at least this far apart across the floor, metres. */
  minSpan: 0.5, // TUNE
  /** Squeezed right up to the Keeper, the camera climbs this much more, metres, and looks down. */
  squeezeRise: 2.0, // TUNE
  /** An inner room's camera stops this far inside its front wall, metres. */
  frontMargin: 0.3, // TUNE
  /** ...and this far from its side walls. */
  sideMargin: 0.3, // TUNE
  /** ...and this far under its ceiling. */
  ceilingMargin: 0.3, // TUNE
  /** A front room's camera may stand this far out on the porch, metres. */
  porchBack: HOUSE_KID.minStandBack,
  /** The camera keeps this far from furniture across the floor (the low tier's Kitchen table), metres. */
  nearClear: 0.45, // TUNE
  /** How finely the camera is drawn in toward the Keeper to clear furniture, metres. */
  nearStep: 0.1, // TUNE
  /** Horizontal view angle, degrees; a tall phone's vertical one is capped at `maxFov`. */
  hfov: 74, // TUNE
  maxFov: 80, // TUNE
  /** Seconds for the camera to catch up (an exponential ease). */
  lag: 0.28, // TUNE
  /** A bed's footprint (`bedFrame`, 1.5 × 1.1 m at yaw 0): half its length and width, and its height. */
  bed: { long: 0.75, wide: 0.55, height: 0.6 },
  /** Where a Keeper put into a room stands, as shares of its walkable width and depth. */
  start: [0.5, 0.5], // TUNE
} as const;

/** A rectangle of floor at one height (`room` is '' for a doorway's strip). */
export interface WalkRect {
  readonly room: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y: number;
}

/** Stairs: a rectangle whose floor climbs from `y0` at `z0` to `y1` at `z1`. */
export interface WalkRamp {
  readonly room: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y0: number;
  readonly y1: number;
  /**
   * The stairs' own piece, if it was built: beside the ramp it blocks only
   * where the steps stand taller than a step up from the floor, so the
   * Keeper can step on at the foot.
   */
  readonly sides: Footprint | null;
}

/** A piece of furniture's box on the floor, metres: its foot and top too. */
export interface Footprint {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y0: number;
  readonly y1: number;
}

export interface WalkMap {
  readonly rooms: readonly RoomBox[];
  readonly rects: readonly WalkRect[];
  readonly ramps: readonly WalkRamp[];
  /** The furniture that blocks: taller than a step, and not room-wide. */
  readonly blocks: readonly Footprint[];
  /** The front of the house (the lowest room `z0`): a room starting there may use the porch. */
  readonly front: number;
}

/** Where the Keeper stands (its feet), updated in place as it walks. */
export interface WalkSpot {
  x: number;
  z: number;
  y: number;
}

/** A camera pose updated in place (a `HousePose` the walk can write into). */
export interface FollowPose {
  readonly eye: { x: number; y: number; z: number };
  readonly target: { x: number; y: number; z: number };
  fov: number;
  pitch: number;
}

export function createFollowPose(): FollowPose {
  return { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 }, fov: 1, pitch: 0 };
}

const inside = (
  x: number,
  z: number,
  r: { x0: number; x1: number; z0: number; z1: number },
): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Within `r` of a footprint, across the floor. */
const near = (x: number, z: number, f: Footprint, r: number): boolean =>
  x > f.x0 - r && x < f.x1 + r && z > f.z0 - r && z < f.z1 + r;

/** The stairs' floor height at `z`. */
const rampHeight = (ramp: WalkRamp, z: number): number => {
  const t = Math.min(1, Math.max(0, (z - ramp.z0) / (ramp.z1 - ramp.z0)));
  return ramp.y0 + (ramp.y1 - ramp.y0) * t;
};

/**
 * The walkable floor: each room's floor rect inset by half the wall and the
 * Keeper's radius, a strip through each inside doorway, and in a two-storey
 * Heart Hall the gallery deck and the stairs as a ramp up to it.
 */
export function walkMap(
  boxes: readonly RoomBox[],
  runs: readonly WallRun[],
  furniture: readonly Footprint[],
): WalkMap {
  const r = HOUSE_WALK.radius;
  const wall = HOUSE_GRID.wall;
  const inset = wall / 2 + r;
  const rects: WalkRect[] = [];
  const ramps: WalkRamp[] = [];
  for (const b of boxes) {
    rects.push({
      room: b.id,
      x0: b.x0 + inset,
      x1: b.x1 - inset,
      z0: b.z0 + inset,
      z1: b.z1 - inset,
      y: b.y0,
    });
    if (b.look !== 'heart-hall' || b.storeys < 2) continue;
    // As heartHallRoom builds them: the gallery along the back wall at the
    // second storey, the stairs up the east wall to its front edge.
    const g = HOUSE_GROWN.hall;
    const front = b.z1 - b.z0 - wall / 2 - g.galleryDepth;
    const run = front - 0.6;
    const up = b.y0 + HOUSE_GRID.storey;
    rects.push({
      room: b.id,
      x0: b.x0 + inset,
      x1: b.x1 - inset,
      z0: b.z0 + front + r,
      z1: b.z1 - inset,
      y: up,
    });
    if (run < 2) continue;
    const sx = b.x1 - g.stairWidth / 2 - wall / 2;
    // The ramp reaches a little onto the floor at its foot and onto the deck
    // at its top, so the Keeper steps on and off; it keeps clear of the rail.
    const ramp = {
      x0: sx - g.stairWidth / 2 + r * 0.6,
      x1: sx + g.stairWidth / 2 - r * 0.6,
      z0: b.z0 + front - run - 0.25,
      z1: b.z0 + front + r + 0.05,
    };
    const mx = (ramp.x0 + ramp.x1) / 2;
    const mz = (ramp.z0 + ramp.z1) / 2;
    const sides =
      furniture.find((f) => inside(mx, mz, f) && Math.abs(f.y0 - b.y0) < 0.3 && f.y1 >= up - 0.3) ??
      null;
    ramps.push({ room: b.id, ...ramp, y0: b.y0, y1: up, sides });
  }
  for (const run of runs) {
    if (run.exterior) continue;
    for (const door of run.doors) {
      const half = door.w / 2 - r * 0.7;
      if (half <= 0) continue;
      const u = run.from + door.u;
      // Deep enough to overlap both rooms' inset floors.
      const across = inset + 0.05;
      rects.push(
        run.axis === 'x'
          ? {
              room: '',
              x0: u - half,
              x1: u + half,
              z0: run.at - across,
              z1: run.at + across,
              y: run.y0,
            }
          : {
              room: '',
              x0: run.at - across,
              x1: run.at + across,
              z0: u - half,
              z1: u + half,
              y: run.y0,
            },
      );
    }
  }
  const blocks = furniture.filter(
    (f) =>
      f.y1 - f.y0 >= HOUSE_WALK.stepOver &&
      (f.x1 - f.x0) * (f.z1 - f.z0) <= HOUSE_WALK.wideIgnore &&
      !ramps.some((ramp) => ramp.sides === f),
  );
  const front = boxes.reduce((m, b) => Math.min(m, b.z0), Infinity);
  return { rooms: boxes, rects, ramps, blocks, front };
}

/**
 * The floor height at (x, z) the Keeper can reach from height `y`, or NaN:
 * no floor there (a wall, the edge of the gallery) or furniture in the way.
 */
export function floorAt(map: WalkMap, x: number, z: number, y: number): number {
  for (const ramp of map.ramps) {
    if (!inside(x, z, ramp)) continue;
    const h = rampHeight(ramp, z);
    if (Math.abs(h - y) < HOUSE_WALK.rampReach) return h;
  }
  let best = NaN;
  for (const rect of map.rects) {
    if (!inside(x, z, rect) || Math.abs(rect.y - y) > HOUSE_WALK.floorReach) continue;
    if (Number.isNaN(best) || Math.abs(rect.y - y) < Math.abs(best - y)) best = rect.y;
  }
  if (Number.isNaN(best)) return NaN;
  const r = HOUSE_WALK.radius;
  for (const f of map.blocks) {
    // Standing on this floor (its foot on it) and taller than a step.
    if (Math.abs(f.y0 - best) > 0.3 || f.y1 < best + HOUSE_WALK.stepOver) continue;
    if (near(x, z, f, r)) return NaN;
  }
  for (const ramp of map.ramps) {
    const f = ramp.sides;
    if (!f || Math.abs(f.y0 - best) > 0.3 || !near(x, z, f, r)) continue;
    if (rampHeight(ramp, z) > best + HOUSE_WALK.stepOver) return NaN;
  }
  return best;
}

/**
 * One step of (dx, dz) metres, sliding along walls and furniture: the full
 * step, else along x only, else along z only. Moves `at` in place (its
 * height follows the floor); false when it's boxed in and stays put.
 */
export function slideStep(map: WalkMap, at: WalkSpot, dx: number, dz: number): boolean {
  if (dx === 0 && dz === 0) return false;
  let y = floorAt(map, at.x + dx, at.z + dz, at.y);
  if (!Number.isNaN(y)) return put(at, at.x + dx, at.z + dz, y);
  if (dx !== 0) {
    y = floorAt(map, at.x + dx, at.z, at.y);
    if (!Number.isNaN(y)) return put(at, at.x + dx, at.z, y);
  }
  if (dz !== 0) {
    y = floorAt(map, at.x, at.z + dz, at.y);
    if (!Number.isNaN(y)) return put(at, at.x, at.z + dz, y);
  }
  return false;
}

function put(at: WalkSpot, x: number, z: number, y: number): true {
  at.x = x;
  at.z = z;
  at.y = y;
  return true;
}

/** The room the Keeper stands in (the stairs are the Hall's), or null between rooms (a doorway). */
export function roomAt(map: WalkMap, at: WalkSpot): RoomBox | null {
  let id: string | null = null;
  for (const ramp of map.ramps) if (inside(at.x, at.z, ramp)) id = ramp.room;
  if (id === null) {
    for (const rect of map.rects) {
      if (rect.room === '' || !inside(at.x, at.z, rect)) continue;
      if (Math.abs(rect.y - at.y) <= HOUSE_WALK.floorReach) {
        id = rect.room;
        break;
      }
    }
  }
  if (id === null) return null;
  for (const b of map.rooms) if (b.id === id) return b;
  return null;
}

/**
 * Where a Keeper put into `room` stands: `HOUSE_WALK.start` of the way
 * across its walkable floor, and never so near an inner room's front wall
 * that the camera is squeezed (the Heart Hall's looked steeply down); or the
 * nearest free spot to that (a bed or a table there), else null.
 */
export function startSpot(map: WalkMap, room: RoomBox): WalkSpot | null {
  const rect = map.rects.find((r) => r.room === room.id && r.y === room.y0);
  if (!rect) return null;
  const [sx, sz] = HOUSE_WALK.start;
  const cx = rect.x0 + (rect.x1 - rect.x0) * sx;
  // At least deep enough for the camera's full step back.
  const back = cameraFront(map, room) + HOUSE_WALK.back;
  const cz = Math.min(rect.z1, Math.max(rect.z0 + (rect.z1 - rect.z0) * sz, back));
  // Rings out from the middle, a quarter metre at a time.
  for (let ring = 0; ring < 12; ring += 1) {
    const d = ring * 0.25;
    const n = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.sin(a) * d;
      const z = cz - Math.cos(a) * d;
      if (!inside(x, z, rect)) continue;
      const y = floorAt(map, x, z, room.y0);
      if (!Number.isNaN(y)) return { x, z, y };
    }
  }
  return null;
}

/**
 * How far out the follow camera may stand in `room`: a room at the house's
 * front may use the porch, any other stops just inside its own front wall.
 */
export function cameraFront(map: WalkMap, room: RoomBox): number {
  return room.z0 <= map.front + 1e-6
    ? room.z0 - HOUSE_WALK.porchBack
    : room.z0 + HOUSE_WALK.frontMargin;
}

/** The camera's heading, radians from looking straight in (+z): the Keeper's, halved and held to ±`maxYaw`. */
export function followTurn(yaw: number): number {
  const W = HOUSE_WALK;
  // Models face −z at yaw 0, so the Keeper heads straight in (+z) at yaw π.
  const heading = Math.atan2(Math.sin(yaw - Math.PI), Math.cos(yaw - Math.PI));
  // Heading back toward the camera, it keeps looking straight in.
  if (Math.abs(heading) > W.turnAway) return 0;
  const max = (W.maxYaw * Math.PI) / 180;
  return Math.max(-max, Math.min(max, heading * W.turnShare));
}

/**
 * The follow camera, written into `out`: behind the Keeper, turned with it
 * (`followTurn`), never standing in another room. It's drawn in toward the
 * Keeper along its own heading until it's inside `room` (or on the porch
 * for a front room), under its ceiling and clear of furniture; squeezed
 * like that, it climbs and looks down at the Keeper instead of past it.
 */
export function followPose(
  out: FollowPose,
  map: WalkMap,
  at: WalkSpot,
  yaw: number,
  room: RoomBox,
  aspect: number,
): FollowPose {
  const W = HOUSE_WALK;
  const turn = followTurn(yaw);
  const dx = Math.sin(turn);
  const dz = Math.cos(turn);
  // The furthest back the room allows along that heading: its front (dz > 0
  // always, as |turn| ≤ maxYaw) and its side walls.
  let d: number = W.back;
  d = Math.min(d, Math.max(0, (at.z - cameraFront(map, room)) / dz));
  const xMin = room.x0 + W.sideMargin;
  const xMax = room.x1 - W.sideMargin;
  if (dx > 1e-6) d = Math.min(d, Math.max(0, (at.x - xMin) / dx));
  else if (dx < -1e-6) d = Math.min(d, Math.max(0, (at.x - xMax) / dx));
  // Clear of furniture standing up into the camera's way (the low tier's
  // Kitchen table filled the frame's corner).
  while (d > 0 && nearFurniture(map, at.x - dx * d, at.z - dz * d, at.y)) d -= W.nearStep;
  d = Math.max(0, d);
  const squeeze = 1 - d / W.back;
  const eyeY = Math.min(at.y + W.eyeHeight + W.squeezeRise * squeeze, room.y1 - W.ceilingMargin);
  out.eye.x = at.x - dx * d;
  out.eye.y = eyeY;
  out.eye.z = at.z - dz * d;
  const ahead = Math.max(W.lookAhead * (1 - squeeze), W.minSpan - d);
  out.target.x = at.x + dx * ahead;
  out.target.y = at.y + W.lookHeight;
  out.target.z = at.z + dz * ahead;
  const fx = out.target.x - out.eye.x;
  const fy = out.target.y - out.eye.y;
  const fz = out.target.z - out.eye.z;
  out.pitch = Math.asin(-fy / (Math.hypot(fx, fy, fz) || 1));
  const deg = Math.PI / 180;
  out.fov = Math.min(W.maxFov * deg, 2 * Math.atan(Math.tan((W.hfov * deg) / 2) / aspect));
  return out;
}

/** Furniture standing up from the Keeper's floor within `nearClear` of (x, z). */
function nearFurniture(map: WalkMap, x: number, z: number, y: number): boolean {
  const c = HOUSE_WALK.nearClear;
  for (const f of map.blocks) {
    if (f.y1 < y + HOUSE_WALK.stepOver || f.y0 > y + HOUSE_WALK.eyeHeight) continue;
    if (near(x, z, f, c)) return true;
  }
  return false;
}

/** Eases `pose` toward `goal` over `dt` seconds (the camera's lag), in place. */
export function easePose(pose: FollowPose, goal: FollowPose, dt: number): FollowPose {
  const k = 1 - Math.exp(-Math.max(0, dt) / HOUSE_WALK.lag);
  pose.eye.x += (goal.eye.x - pose.eye.x) * k;
  pose.eye.y += (goal.eye.y - pose.eye.y) * k;
  pose.eye.z += (goal.eye.z - pose.eye.z) * k;
  pose.target.x += (goal.target.x - pose.target.x) * k;
  pose.target.y += (goal.target.y - pose.target.y) * k;
  pose.target.z += (goal.target.z - pose.target.z) * k;
  pose.fov += (goal.fov - pose.fov) * k;
  pose.pitch += (goal.pitch - pose.pitch) * k;
  return pose;
}

/** Copies `from` into `to`. */
export function copyPose(to: FollowPose, from: FollowPose): FollowPose {
  to.eye.x = from.eye.x;
  to.eye.y = from.eye.y;
  to.eye.z = from.eye.z;
  to.target.x = from.target.x;
  to.target.y = from.target.y;
  to.target.z = from.target.z;
  to.fov = from.fov;
  to.pitch = from.pitch;
  return to;
}
