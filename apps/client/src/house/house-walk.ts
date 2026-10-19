import { HOUSE_GRID, HOUSE_GROWN, HOUSE_WALK } from './house-config.js';
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

/**
 * The clear lane in front of an inside doorway, on one side of it (#381 W3):
 * no furniture that blocks the Keeper stands in it, so every doorway can be
 * walked through and turned out of. `axis` is the wall's: an `x` wall runs
 * across the house (a front or back wall).
 */
export interface DoorLane {
  /** The room it's in. */
  readonly room: string;
  readonly axis: 'x' | 'z';
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Its floor's height. */
  readonly y: number;
}

/** A deck the Heart Hall builds at its second storey for the walk (#381 W3), with rails along its open edges. */
export interface HallDeck {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y: number;
  /** Each rail: the edge it runs along (`x`: across, at z = `at`) from `from` to `to`. */
  readonly rails: readonly { axis: 'x' | 'z'; at: number; from: number; to: number }[];
  /** Where posts hold it up from the floor below. */
  readonly posts: readonly { x: number; z: number }[];
}

export interface WalkMap {
  readonly rooms: readonly RoomBox[];
  readonly rects: readonly WalkRect[];
  /** Every inside doorway's clear lanes (`doorLanes`). */
  readonly lanes: readonly DoorLane[];
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
  /**
   * Turned round to follow a Keeper heading back toward the front (a storey
   * up, W3). `followPose` reads it back from the goal it writes, for its
   * band; copies (the eased camera) carry it but nothing reads it there.
   */
  reverse: boolean;
}

export function createFollowPose(): FollowPose {
  return {
    eye: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 1 },
    fov: 1,
    pitch: 0,
    reverse: false,
  };
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
 * The clear lanes in front of every inside doorway, one each side
 * (`HOUSE_WALK.doorLane`: the Keeper's width and a turn deep, the doorway
 * and a little wider). Room builders keep their furniture out of them.
 */
export function doorLanes(runs: readonly WallRun[]): DoorLane[] {
  const { depth, side } = HOUSE_WALK.doorLane;
  const face = HOUSE_GRID.wall / 2;
  const lanes: DoorLane[] = [];
  const back = (at: number): [number, number] => [at + face, at + face + depth];
  const fore = (at: number): [number, number] => [at - face - depth, at - face];
  for (const run of runs) {
    if (run.exterior || run.other === null) continue;
    for (const door of run.doors) {
      const u = run.from + door.u;
      const a = u - door.w / 2 - side;
      const b = u + door.w / 2 + side;
      // An inside wall is kept by the room behind it (an x wall) or to its
      // west (a z wall); `other` is across it.
      const sides: [string, [number, number]][] =
        run.axis === 'x'
          ? [
              [run.room, back(run.at)],
              [run.other, fore(run.at)],
            ]
          : [
              [run.room, fore(run.at)],
              [run.other, back(run.at)],
            ];
      for (const [room, [lo, hi]] of sides)
        lanes.push(
          run.axis === 'x'
            ? { room, axis: 'x', x0: a, x1: b, z0: lo, z1: hi, y: run.y0 }
            : { room, axis: 'z', x0: lo, x1: hi, z0: a, z1: b, y: run.y0 },
        );
    }
  }
  return lanes;
}

/** Whether a box on the floor at height `y` stands in any of the lanes. */
export function inLane(
  lanes: readonly DoorLane[],
  f: { x0: number; x1: number; z0: number; z1: number },
  y: number,
): boolean {
  return lanes.some(
    (l) => Math.abs(l.y - y) < 0.3 && f.x0 < l.x1 && f.x1 > l.x0 && f.z0 < l.z1 && f.z1 > l.z0,
  );
}

/**
 * The way from the Heart Hall's gallery to a doorway into its second storey
 * from the front (#381 W3: the Kitchen loft's): a walkway down the west wall
 * (the stairs have the east) to a landing in front of the doorway. `decks`
 * is what the Hall builds, `floors` what the Keeper walks on (overlapping
 * each other, the gallery's floor and the doorway's strip). Nothing without
 * such a doorway.
 */
export function loftWalk(
  box: RoomBox,
  lanes: readonly DoorLane[],
): { decks: HallDeck[]; floors: WalkRect[] } {
  const decks: HallDeck[] = [];
  const floors: WalkRect[] = [];
  if (box.look !== 'heart-hall' || box.storeys < 2) return { decks, floors };
  const r = HOUSE_WALK.radius;
  const face = HOUSE_GRID.wall / 2;
  const inset = face + r;
  const g = HOUSE_GROWN.hall;
  const up = box.y0 + HOUSE_GRID.storey;
  const front = box.z0 + face;
  const lane = lanes.find(
    (l) => l.room === box.id && l.axis === 'x' && Math.abs(l.y - up) < 0.3 && l.z0 < front + 0.1,
  );
  if (!lane) return { decks, floors };
  const galleryFront = box.z1 - face - g.galleryDepth;
  const wx1 = box.x0 + face + g.walkway;
  // The landing reaches past the lane far enough for the Keeper to stand at its edge.
  const lx1 = Math.min(box.x1 - face, lane.x1 + r);
  const lz1 = front + g.walkway;
  const landing = lx1 > wx1;
  decks.push({
    x0: box.x0 + face,
    x1: wx1,
    z0: front,
    z1: galleryFront,
    y: up,
    rails: [{ axis: 'z', at: wx1, from: landing ? lz1 : front, to: galleryFront }],
    posts: [{ x: wx1 - 0.1, z: ((landing ? lz1 : front) + galleryFront) / 2 }],
  });
  floors.push({
    room: box.id,
    x0: box.x0 + inset,
    x1: wx1 - r,
    z0: box.z0 + inset,
    z1: galleryFront + r + 0.05,
    y: up,
  });
  if (landing) {
    decks.push({
      x0: wx1,
      x1: lx1,
      z0: front,
      z1: lz1,
      y: up,
      rails: [
        { axis: 'x', at: lz1, from: wx1, to: lx1 },
        { axis: 'z', at: lx1, from: front, to: lz1 },
      ],
      posts: [{ x: lx1 - 0.1, z: lz1 - 0.1 }],
    });
    floors.push({
      room: box.id,
      x0: wx1 - r - 0.05,
      x1: lx1 - r,
      z0: box.z0 + inset,
      z1: lz1 - r,
      y: up,
    });
  }
  return { decks, floors };
}

/**
 * The floor the Keeper stands on, by its feet's height: on the stairs it
 * goes up a floor past `HOUSE_WALK.floorSwitch` of a storey and back down
 * below it, with `floorBand` either side where it stays on `was` (no flip
 * on every nudge across the line).
 */
export function standingFloor(y: number, was = -1): number {
  const { floorSwitch, floorBand } = HOUSE_WALK;
  const up = floorAbove(y, floorSwitch + floorBand);
  const down = floorAbove(y, floorSwitch - floorBand);
  return was >= up && was <= down ? was : floorAbove(y, floorSwitch);
}

/** The floor at height `y` when a floor starts `share` of a storey above its level. */
const floorAbove = (y: number, share: number): number =>
  Math.max(0, Math.floor(y / HOUSE_GRID.storey + 1 - share + 1e-6));

/**
 * The walkable floor: each room's floor rect inset by half the wall and the
 * Keeper's radius, a strip through each inside doorway, and in a two-storey
 * Heart Hall the gallery deck and the stairs as a ramp up to it, and the
 * walkway to an upstairs doorway (`loftWalk`).
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
  const lanes = doorLanes(runs);
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
    rects.push(...loftWalk(b, lanes).floors);
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
      // The Keeper's whole body fits through: its middle keeps its radius from each jamb.
      const half = door.w / 2 - r;
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
  return { rooms: boxes, rects, lanes, ramps, blocks, front };
}

/**
 * The floor height at (x, z) the Keeper can reach from height `y`, or NaN:
 * no floor there (a wall, the edge of the gallery) or furniture in the way.
 */
export function floorAt(map: WalkMap, x: number, z: number, y: number): number {
  // On the stairs nothing else is checked: nothing stands on them (the stairs'
  // own piece is `ramp.sides`, and the Hall builds nothing over them).
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
  return nearestFree(map, rect, cx, cz);
}

/**
 * The free floor in `rect` nearest (x, z) (furniture kept clear of), in
 * rings out from it `step` metres apart up to 3 m, or null. A Keeper put
 * where a bed stands (W3: a bed moved off a doorway's lane) stands beside it.
 */
export function nearestFree(
  map: WalkMap,
  rect: WalkRect,
  x: number,
  z: number,
  step = 0.25,
): WalkSpot | null {
  const rings = Math.round(3 / step);
  for (let ring = 0; ring < rings; ring += 1) {
    const d = ring * step;
    const n = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.sin(a) * d;
      const pz = z - Math.cos(a) * d;
      if (!inside(px, pz, rect)) continue;
      const y = floorAt(map, px, pz, rect.y);
      if (!Number.isNaN(y)) return { x: px, z: pz, y };
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
 * A storey up in the Hall it never climbs, and turns round to follow a
 * Keeper heading back toward the front (W3). Residents in its way fade
 * instead (`blockerFade`).
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
  // A storey up in a two-storey room (the Hall's gallery, the walkway and
  // the landing, #381 W3: the owner's render check), it looks along the
  // way the Keeper walks, even back toward the front, from behind it and at
  // kid height: there's no front wall to squeeze against, only the room.
  // `out` remembers whether it had turned round: it turns round past
  // `turnAway` and back only `reverseBand` short of it, and stays turned
  // round down the stairs until the floor cut would switch (no 180° flip
  // on every wobble of the heading or the step).
  const was = out.reverse;
  const up = room.y0 + (was ? HOUSE_GRID.storey * W.floorSwitch : HOUSE_GRID.storey - W.floorReach);
  const upper = room.storeys > 1 && at.y >= up;
  const heading = Math.atan2(Math.sin(yaw - Math.PI), Math.cos(yaw - Math.PI));
  const reverse = upper && Math.abs(heading) > (was ? W.turnAway - W.reverseBand : W.turnAway);
  out.reverse = reverse;
  const turn = followTurn(reverse ? yaw - Math.PI : yaw);
  const sign = reverse ? -1 : 1;
  const dx = Math.sin(turn) * sign;
  const dz = Math.cos(turn) * sign;
  // The furthest back the room allows along that heading: its front (or its
  // back, looking out) and its side walls.
  let d: number = W.back;
  if (dz > 0) d = Math.min(d, Math.max(0, (at.z - cameraFront(map, room)) / dz));
  else d = Math.min(d, Math.max(0, (room.z1 - W.frontMargin - at.z) / -dz));
  const xMin = room.x0 + W.sideMargin;
  const xMax = room.x1 - W.sideMargin;
  if (dx > 1e-6) d = Math.min(d, Math.max(0, (at.x - xMin) / dx));
  else if (dx < -1e-6) d = Math.min(d, Math.max(0, (at.x - xMax) / dx));
  // Clear of furniture standing up into the camera's way (the low tier's
  // Kitchen table filled the frame's corner).
  while (d > 0 && nearFurniture(map, at.x - dx * d, at.z - dz * d, at.y)) d -= W.nearStep;
  d = Math.max(0, d);
  const squeeze = upper ? 0 : 1 - d / W.back;
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

/** A resident as the camera's fade sees it: its middle and its body's radius. */
export interface WalkBlocker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How far it reaches from its middle, metres. */
  readonly r: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of a resident shows from `eye` (#381 W2, the owner's render
 * check): it fades out as the camera comes within about a metre of it
 * (`HOUSE_WALK.fadeNear`), and as it stands across the line from the camera
 * to the Keeper's chest at (kx, ky, kz), or round it (the Keeper walks
 * through residents until W4). 1 shows it whole, 0 not at all.
 */
export function blockerFade(
  eye: { readonly x: number; readonly y: number; readonly z: number },
  kx: number,
  ky: number,
  kz: number,
  b: WalkBlocker,
): number {
  const [nearGone, nearWhole] = HOUSE_WALK.fadeNear;
  const near = smoothstep(
    nearGone,
    nearWhole,
    Math.hypot(b.x - eye.x, b.y - eye.y, b.z - eye.z) - b.r,
  );
  const sx = kx - eye.x;
  const sy = ky - eye.y;
  const sz = kz - eye.z;
  const ss = sx * sx + sy * sy + sz * sz;
  if (ss <= 0) return near;
  const t = Math.min(
    1,
    Math.max(0, ((b.x - eye.x) * sx + (b.y - eye.y) * sy + (b.z - eye.z) * sz) / ss),
  );
  // Past the Keeper it hides nothing.
  if (t >= 1) return near;
  const gap = Math.hypot(eye.x + sx * t - b.x, eye.y + sy * t - b.y, eye.z + sz * t - b.z);
  return Math.min(near, smoothstep(b.r * HOUSE_WALK.fadeEdge, b.r, gap));
}

/**
 * Furniture standing up from the Keeper's floor within `nearClear` of (x, z),
 * tall enough to reach into the camera's view (#381 W2: a toy by the Snug's
 * front drew it in and tipped it down 30°).
 */
function nearFurniture(map: WalkMap, x: number, z: number, y: number): boolean {
  const c = HOUSE_WALK.nearClear;
  for (const f of map.blocks) {
    if (f.y1 < y + HOUSE_WALK.nearTall || f.y0 > y + HOUSE_WALK.eyeHeight) continue;
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
  pose.reverse = goal.reverse;
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
  to.reverse = from.reverse;
  return to;
}
