import { HOUSE_GRID, HOUSE_GROWN } from './house-config.js';
import type { RoomBox, WallRun } from './house-layout.js';
import type { HousePose } from './house-camera.js';

/*
 * MOCKUP ONLY (#381 Keeper walk, branch issue-381-keeper-walk-mockup, no PR):
 * the Keeper walking about inside the house. Pure: the walkable floor
 * (every room's floor inset from its walls, the doorways between rooms, the
 * Heart Hall's gallery and its stairs), the furniture footprints it can't
 * walk through, and the follow camera that keeps to the Keeper's room so
 * only that room's front wall ever fades.
 */

export const HOUSE_WALK = {
  /** Metres a second at full push. */
  speed: 1.5, // TUNE
  /** The Keeper's footprint, metres (it keeps this far from walls and furniture). */
  radius: 0.28, // TUNE
  /** Furniture lower than this is walked over (rugs). */
  stepOver: 0.15, // TUNE
  /** The camera's eye above the Keeper's floor (a bit over a squishy's eye: kid height). */
  eyeHeight: 1.7, // TUNE: over the Keeper's head, looking down a little
  /** How far behind the Keeper the camera stands, metres. */
  back: 3.4, // TUNE
  /** The camera never swings round more than this from looking into the house, degrees. */
  maxYaw: 28, // TUNE
  /** It looks at about the Keeper's chest. */
  lookHeight: 0.55, // TUNE
  /** Horizontal view angle, degrees (a tall phone's vertical one is capped at `maxFov`). */
  hfov: 74, // TUNE
  maxFov: 80, // TUNE
  /** Seconds for the camera to catch up (exponential ease). */
  lag: 0.28, // TUNE
} as const;

/** A rectangle of floor at one height. */
export interface WalkRect {
  readonly room: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y: number;
}

/** Stairs: a rectangle whose floor climbs from `y0` at `z0` to `y1` at `z1`. */
export interface WalkRamp extends Omit<WalkRect, 'y'> {
  readonly y0: number;
  readonly y1: number;
}

/** Something on the floor the Keeper walks round. */
export interface Footprint {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Its foot and top, metres. */
  readonly y0: number;
  readonly y1: number;
}

export interface WalkMap {
  readonly rects: readonly WalkRect[];
  readonly ramps: readonly WalkRamp[];
  readonly blocks: readonly Footprint[];
}

export interface WalkSpot {
  x: number;
  z: number;
  y: number;
}

/** The floors of the rooms, inset by the wall and the Keeper's radius, plus a strip through each door. */
export function walkMap(
  boxes: readonly RoomBox[],
  runs: readonly WallRun[],
  furniture: readonly Footprint[],
): WalkMap {
  const r = HOUSE_WALK.radius;
  const inset = HOUSE_GRID.wall / 2 + r;
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
    if (b.look === 'heart-hall' && b.storeys > 1) {
      // As heartHallRoom builds them: the gallery along the back wall at the
      // second storey, stairs up the east wall to its front edge.
      const g = HOUSE_GROWN.hall;
      const d = b.z1 - b.z0;
      const front = d - HOUSE_GRID.wall / 2 - g.galleryDepth;
      const run = front - 0.6;
      const sx = b.x1 - g.stairWidth / 2 - HOUSE_GRID.wall / 2;
      const up = b.y0 + HOUSE_GRID.storey;
      rects.push({
        room: b.id,
        x0: b.x0 + inset,
        x1: b.x1 - inset,
        z0: b.z0 + front + r,
        z1: b.z1 - inset,
        y: up,
      });
      if (run >= 2)
        ramps.push({
          room: b.id,
          x0: sx - g.stairWidth / 2 + r * 0.6,
          x1: sx + g.stairWidth / 2 - r * 0.6,
          z0: b.z0 + front - run - 0.25,
          z1: b.z0 + front + r + 0.05,
          y0: b.y0,
          y1: up,
        });
    }
  }
  for (const run of runs) {
    if (run.exterior) continue;
    for (const door of run.doors) {
      const half = door.w / 2 - r * 0.7;
      if (half <= 0) continue;
      const u = run.from + door.u;
      const across = HOUSE_GRID.wall / 2 + r + 0.05;
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
  return { rects, ramps, blocks: furniture.filter((f) => f.y1 - f.y0 >= HOUSE_WALK.stepOver) };
}

const inRect = (p: { x: number; z: number }, r: Omit<WalkRect, 'y' | 'room'>): boolean =>
  p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;

/** The floor height under `p` reached from height `y`, or null: no floor there (a wall, the edge). */
export function floorAt(map: WalkMap, p: { x: number; z: number }, y: number): number | null {
  for (const ramp of map.ramps) {
    if (!inRect(p, ramp)) continue;
    const t = Math.min(1, Math.max(0, (p.z - ramp.z0) / (ramp.z1 - ramp.z0)));
    const h = ramp.y0 + (ramp.y1 - ramp.y0) * t;
    if (Math.abs(h - y) < 0.6) return h;
  }
  let best: number | null = null;
  for (const rect of map.rects) {
    if (!inRect(p, rect) || Math.abs(rect.y - y) > 0.45) continue;
    if (best === null || Math.abs(rect.y - y) < Math.abs(best - y)) best = rect.y;
  }
  if (best === null) return null;
  const r = HOUSE_WALK.radius;
  for (const f of map.blocks) {
    // Something standing on this floor (its foot on it) and taller than a
    // step, near enough to touch; a room-wide merged group (beams, bunting) never.
    if (Math.abs(f.y0 - best) > 0.3 || f.y1 < best + 0.2) continue;
    if ((f.x1 - f.x0) * (f.z1 - f.z0) > 6) continue; // TUNE
    if (p.x > f.x0 - r && p.x < f.x1 + r && p.z > f.z0 - r && p.z < f.z1 + r) return null;
  }
  return best;
}

/** One step from `at` toward `to`, sliding along walls and furniture; `at` itself if boxed in. */
export function slideStep(map: WalkMap, at: WalkSpot, to: { x: number; z: number }): WalkSpot {
  for (const p of [to, { x: to.x, z: at.z }, { x: at.x, z: to.z }]) {
    const y = floorAt(map, p, at.y);
    if (y !== null) return { x: p.x, z: p.z, y };
  }
  return at;
}

/** The room the Keeper stands in (the one whose floor rect it's on, at its height). */
export function roomAt(map: WalkMap, at: WalkSpot): string | null {
  for (const ramp of map.ramps) if (inRect(at, ramp)) return ramp.room;
  for (const rect of map.rects)
    if (rect.room !== '' && inRect(at, rect) && Math.abs(rect.y - at.y) < 0.45) return rect.room;
  return null;
}

/**
 * The follow camera: behind the Keeper and a little above it, turning with
 * it but never more than `maxYaw` from looking into the house (so it always
 * looks through the open dollhouse side), and never standing in another
 * room: in an inner room it stops just inside that room's front wall (and
 * climbs a little to see over the Keeper); a front room's camera may stand
 * out on the porch, as the walk-in view does.
 */
export function followPose(
  at: WalkSpot,
  yaw: number,
  room: RoomBox,
  frontZ: number,
  aspect: number,
): HousePose {
  const W = HOUSE_WALK;
  const DEG = Math.PI / 180;
  // The Keeper faces −z at yaw 0, so it walks into the house (+z) at yaw π.
  let face = yaw - Math.PI;
  face = Math.atan2(Math.sin(face), Math.cos(face));
  // Walking toward the camera (or facing it) the camera keeps looking straight in.
  const turn =
    Math.abs(face) > 1.9 ? 0 : Math.max(-W.maxYaw * DEG, Math.min(W.maxYaw * DEG, face * 0.5));
  const dx = Math.sin(turn);
  const dz = Math.cos(turn);
  let eye = { x: at.x - dx * W.back, y: at.y + W.eyeHeight, z: at.z - dz * W.back };
  // Never further out than `frontZ`: the porch for a room at the house's
  // front, else just inside the room's own front wall. Squeezed there, it
  // rises and looks down at the Keeper instead of past it.
  let ahead = 1.2;
  if (eye.z < frontZ) {
    const short = Math.min(1, (frontZ - eye.z) / W.back);
    eye = { ...eye, z: frontZ, y: eye.y + 2.0 * short };
    ahead *= 1 - short;
  }
  eye.x = Math.min(room.x1 - 0.3, Math.max(room.x0 + 0.3, eye.x));
  const target = { x: at.x + dx * ahead, y: at.y + W.lookHeight, z: at.z + dz * ahead };
  const f = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const pitch = Math.asin(-f.y / (Math.hypot(f.x, f.y, f.z) || 1));
  const fov = Math.min(W.maxFov * DEG, 2 * Math.atan(Math.tan((W.hfov * DEG) / 2) / aspect));
  return { eye, target, fov, pitch };
}

/** Eases `from` toward `to` over `dt` seconds (the camera's lag). */
export function easePose(from: HousePose, to: HousePose, dt: number): HousePose {
  const k = 1 - Math.exp(-dt / HOUSE_WALK.lag);
  const mix = (a: number, b: number) => a + (b - a) * k;
  const v = (a: HousePose['eye'], b: HousePose['eye']) => ({
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
  });
  return {
    eye: v(from.eye, to.eye),
    target: v(from.target, to.target),
    fov: mix(from.fov, to.fov),
    pitch: mix(from.pitch, to.pitch),
  };
}

/** Where a screen point (CSS px) meets the floor at height `y` under `pose`, or null. */
export function screenToFloor(
  pose: HousePose,
  px: number,
  py: number,
  width: number,
  height: number,
  y: number,
): { x: number; z: number } | null {
  const f = norm({
    x: pose.target.x - pose.eye.x,
    y: pose.target.y - pose.eye.y,
    z: pose.target.z - pose.eye.z,
  });
  // Left-handed (Babylon): right = up × forward, up' = forward × right.
  const right = norm({ x: f.z, y: 0, z: -f.x });
  const up = {
    x: f.y * right.z - f.z * right.y,
    y: f.z * right.x - f.x * right.z,
    z: f.x * right.y - f.y * right.x,
  };
  const t = Math.tan(pose.fov / 2);
  const nx = ((2 * px) / width - 1) * t * (width / height);
  const ny = (1 - (2 * py) / height) * t;
  const d = {
    x: f.x + right.x * nx + up.x * ny,
    y: f.y + right.y * nx + up.y * ny,
    z: f.z + right.z * nx + up.z * ny,
  };
  if (d.y >= -1e-4) return null;
  const s = (y - pose.eye.y) / d.y;
  return { x: pose.eye.x + d.x * s, z: pose.eye.z + d.z * s };
}

function norm(v: { x: number; y: number; z: number }) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
