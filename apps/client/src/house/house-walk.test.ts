import { HOUSE_DATA, roomsAt } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HOUSE_GRID, HOUSE_GROWN } from './house-config.js';
import { roomBox, wallRuns, type RoomBox } from './house-layout.js';
import {
  cameraFront,
  copyPose,
  createFollowPose,
  easePose,
  floorAt,
  followPose,
  followTurn,
  HOUSE_WALK,
  roomAt,
  slideStep,
  startSpot,
  walkMap,
  type Footprint,
  type WalkMap,
  type WalkSpot,
} from './house-walk.js';

const { radius, stepOver } = HOUSE_WALK;
const inset = HOUSE_GRID.wall / 2 + radius;
const DEG = Math.PI / 180;

/** The house at `level` as the scene lays it out, with this furniture. */
function mapAt(level: number, furniture: readonly Footprint[] = []): WalkMap {
  const rooms = roomsAt(HOUSE_DATA, level);
  return walkMap(rooms.map(roomBox), wallRuns(rooms), furniture);
}

const room = (map: WalkMap, look: string): RoomBox => {
  const b = map.rooms.find((r) => r.look === look);
  if (!b) throw new Error(`no ${look}`);
  return b;
};

/** A footprint standing on the floor at `y`. */
const piece = (x0: number, x1: number, z0: number, z1: number, tall = 1, y = 0): Footprint => ({
  x0,
  x1,
  z0,
  z1,
  y0: y,
  y1: y + tall,
});

/** Walks from `at` toward (x, z) in small steps, as the screen will; where it ends up. */
function walkTo(map: WalkMap, at: WalkSpot, x: number, z: number, steps = 400): WalkSpot {
  for (let i = 0; i < steps; i += 1) {
    const dx = x - at.x;
    const dz = z - at.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.02) break;
    const k = Math.min(1, 0.05 / d);
    slideStep(map, at, dx * k, dz * k);
  }
  return at;
}

/** The stairs piece heartHallRoom builds, as the scene measures it (its world box). */
function stairsPiece(hall: RoomBox): Footprint {
  const g = HOUSE_GROWN.hall;
  const front = hall.z1 - hall.z0 - HOUSE_GRID.wall / 2 - g.galleryDepth;
  const run = front - 0.6;
  const sx = hall.x1 - g.stairWidth / 2 - HOUSE_GRID.wall / 2;
  return piece(
    sx - g.stairWidth / 2 - 0.1,
    sx + g.stairWidth / 2,
    hall.z0 + front - run,
    hall.z0 + front,
    HOUSE_GRID.storey + 0.9,
  );
}

describe('the walkable floor (#381 W1)', () => {
  it("is each room's floor, kept clear of its walls by half the wall and the Keeper's radius", () => {
    const map = mapAt(1);
    const snug = room(map, 'snug');
    expect(inset).toBeCloseTo(0.4);
    expect(map.rects).toEqual([
      {
        room: snug.id,
        x0: snug.x0 + inset,
        x1: snug.x1 - inset,
        z0: snug.z0 + inset,
        z1: snug.z1 - inset,
        y: 0,
      },
    ]);
    const mid = (snug.z0 + snug.z1) / 2;
    expect(floorAt(map, snug.x0 + inset + 0.01, mid, 0)).toBe(0);
    // Any nearer the wall, the Keeper's side would be in it.
    expect(floorAt(map, snug.x0 + inset - 0.01, mid, 0)).toBeNaN();
    expect(floorAt(map, snug.x1 - inset + 0.01, mid, 0)).toBeNaN();
  });

  it('puts a strip through each inside doorway, and none through an outside wall', () => {
    const map = mapAt(2);
    const snug = room(map, 'snug');
    const play = room(map, 'playroom');
    const strips = map.rects.filter((r) => r.room === '');
    expect(strips).toHaveLength(1);
    const [door] = strips;
    // Across the wall between them (x = 4.8), deep enough to meet both rooms' floors.
    expect(door!.x0).toBeLessThan(snug.x1 - inset);
    expect(door!.x1).toBeGreaterThan(play.x0 + inset);
    const z = (door!.z0 + door!.z1) / 2;
    const at = { x: snug.x1 - 1, z, y: 0 };
    walkTo(map, at, play.x0 + 1, z);
    expect(at.x).toBeCloseTo(play.x0 + 1, 1);
    expect(roomAt(map, at)?.id).toBe(play.id);
    // Beside the door, the wall stops it.
    const beside = { x: snug.x1 - 1, z: door!.z0 - 0.5, y: 0 };
    walkTo(map, beside, play.x0 + 1, door!.z0 - 0.5);
    expect(beside.x).toBeCloseTo(snug.x1 - inset, 1);
    expect(roomAt(map, beside)?.id).toBe(snug.id);
  });

  it('is between rooms in a doorway (no room), and in its room either side', () => {
    const map = mapAt(2);
    const door = map.rects.find((r) => r.room === '')!;
    const x = (door.x0 + door.x1) / 2;
    expect(roomAt(map, { x, z: (door.z0 + door.z1) / 2, y: 0 })).toBeNull();
  });

  describe("the Heart Hall's stairs", () => {
    const hallMap = (): { map: WalkMap; hall: RoomBox } => {
      const rooms = roomsAt(HOUSE_DATA, 4);
      const boxes = rooms.map(roomBox);
      const hall = boxes.find((b) => b.look === 'heart-hall')!;
      return { map: walkMap(boxes, wallRuns(rooms), [stairsPiece(hall)]), hall };
    };

    it('climb as a ramp from the floor to the gallery deck at storey height', () => {
      const { map, hall } = hallMap();
      expect(map.ramps).toHaveLength(1);
      const ramp = map.ramps[0]!;
      expect(ramp.room).toBe(hall.id);
      expect(ramp.y0).toBe(hall.y0);
      expect(ramp.y1).toBe(hall.y0 + HOUSE_GRID.storey);
      const x = (ramp.x0 + ramp.x1) / 2;
      expect(floorAt(map, x, ramp.z0, 0)).toBeCloseTo(0);
      expect(floorAt(map, x, (ramp.z0 + ramp.z1) / 2, 1.4)).toBeCloseTo(1.5);
      expect(floorAt(map, x, ramp.z1, 2.9)).toBeCloseTo(3);
      // The gallery deck along the back wall, at the second storey.
      const deck = map.rects.find((r) => r.room === hall.id && r.y === HOUSE_GRID.storey)!;
      expect(deck.z1).toBeCloseTo(hall.z1 - inset);
      expect(deck.z0).toBeLessThan(ramp.z1);
      // From the floor, the stairs' middle is too far up to step onto.
      expect(floorAt(map, x, (ramp.z0 + ramp.z1) / 2, 0)).toBeNaN();
    });

    it('take the Keeper up from the floor onto the gallery, and back down', () => {
      const { map, hall } = hallMap();
      const ramp = map.ramps[0]!;
      const x = (ramp.x0 + ramp.x1) / 2;
      // Along the front wall to the stairs' foot, then up.
      const at = { x: hall.x0 + 3, z: hall.z0 + inset + 0.05, y: 0 };
      walkTo(map, at, x, at.z);
      expect(at.x).toBeCloseTo(x, 1);
      walkTo(map, at, x, ramp.z1);
      expect(at.y).toBeCloseTo(HOUSE_GRID.storey, 1);
      expect(roomAt(map, at)?.id).toBe(hall.id);
      // Along the gallery, away from the stairs.
      walkTo(map, at, hall.x0 + 2, hall.z1 - 0.6);
      expect(at.x).toBeCloseTo(hall.x0 + 2, 1);
      expect(at.y).toBe(HOUSE_GRID.storey);
      // The gallery's front edge holds it (no stepping off into the air).
      walkTo(map, at, hall.x0 + 2, hall.z0 + 2);
      expect(at.y).toBe(HOUSE_GRID.storey);
      expect(at.z).toBeGreaterThan(ramp.z1 - 0.5);
      // And back down the stairs.
      walkTo(map, at, x, ramp.z1 - 0.05);
      walkTo(map, at, x, ramp.z0 + 0.3);
      expect(at.y).toBeLessThan(0.3);
    });

    it('block the floor beside their tall steps, but not beside the first', () => {
      const { map } = hallMap();
      const ramp = map.ramps[0]!;
      const side = ramp.sides!;
      expect(side).not.toBeNull();
      // The stairs' own piece isn't furniture: the ramp stands in for it.
      expect(map.blocks).not.toContain(side);
      const west = side.x0 - radius / 2;
      expect(floorAt(map, west, (ramp.z0 + ramp.z1) / 2, 0)).toBeNaN();
      expect(floorAt(map, west, ramp.z0 + 0.1, 0)).toBe(0);
    });

    it('only in a two-storey Hall', () => {
      expect(mapAt(3).ramps).toEqual([]);
    });
  });
});

describe('furniture (#381 W1)', () => {
  const snugMap = (furniture: Footprint[]) => mapAt(1, furniture);

  it('blocks the Keeper when taller than a step, the Keeper kept its radius away', () => {
    const map = snugMap([piece(2, 3, 2, 3)]);
    expect(map.blocks).toHaveLength(1);
    expect(floorAt(map, 2.5, 2.5, 0)).toBeNaN();
    expect(floorAt(map, 2 - radius + 0.02, 2.5, 0)).toBeNaN();
    expect(floorAt(map, 2 - radius - 0.02, 2.5, 0)).toBe(0);
  });

  it('lets the Keeper walk over rugs, and through room-wide merged pieces (beams, bunting)', () => {
    const rug = piece(1, 3, 1, 3, stepOver - 0.05);
    const beams = piece(0, 4.8, 0, 4.8, 0.3, 2.6);
    const wide = piece(0.5, 4.5, 0.5, 2.5, 2);
    const map = snugMap([rug, beams, wide]);
    expect(map.blocks).toEqual([]);
    expect(floorAt(map, 2, 2, 0)).toBe(0);
  });

  it('only blocks on its own floor', () => {
    // A cupboard upstairs, over the Snug: the Snug's floor under it is free.
    const map = mapAt(4, [piece(1, 2, 1, 2, 1, HOUSE_GRID.storey)]);
    expect(floorAt(map, 1.5, 1.5, 0)).toBe(0);
    expect(floorAt(map, 1.5, 1.5, HOUSE_GRID.storey)).toBeNaN();
  });
});

describe('sliding (#381 W1)', () => {
  it('takes the full step when it can', () => {
    const map = mapAt(1);
    const at = { x: 2, z: 2, y: 0 };
    expect(slideStep(map, at, 0.1, 0.1)).toBe(true);
    expect(at).toEqual({ x: 2.1, z: 2.1, y: 0 });
  });

  it('slides along a wall: x only, then z only', () => {
    const map = mapAt(1);
    const snug = room(map, 'snug');
    const edge = snug.z1 - inset;
    // Into the back wall at a slant: it slides along x.
    const back = { x: 2, z: edge - 0.01, y: 0 };
    expect(slideStep(map, back, 0.1, 0.1)).toBe(true);
    expect(back.x).toBeCloseTo(2.1);
    expect(back.z).toBeCloseTo(edge - 0.01);
    // Into the side wall at a slant: x is refused, so it slides along z.
    const side = { x: snug.x1 - inset - 0.01, z: 2, y: 0 };
    expect(slideStep(map, side, 0.1, 0.1)).toBe(true);
    expect(side.x).toBeCloseTo(snug.x1 - inset - 0.01);
    expect(side.z).toBeCloseTo(2.1);
  });

  it('slides along furniture too', () => {
    const map = mapAt(1, [piece(2, 3, 2, 3)]);
    const at = { x: 2.5, z: 2 - radius - 0.01, y: 0 };
    expect(slideStep(map, at, 0.1, 0.1)).toBe(true);
    expect(at.x).toBeCloseTo(2.6);
    expect(at.z).toBeCloseTo(2 - radius - 0.01);
  });

  it('stays put boxed into a corner, or with no step at all', () => {
    const map = mapAt(1);
    const snug = room(map, 'snug');
    const corner = { x: snug.x1 - inset - 0.01, z: snug.z1 - inset - 0.01, y: 0 };
    const was = { ...corner };
    expect(slideStep(map, corner, 0.1, 0.1)).toBe(false);
    expect(corner).toEqual(was);
    expect(slideStep(map, corner, 0, 0)).toBe(false);
  });

  it('allocates nothing: the step moves the spot it was given', () => {
    const map = mapAt(4);
    const at = { x: 2, z: 2, y: 0 };
    const ref = at;
    for (let i = 0; i < 100; i += 1) slideStep(map, at, 0.03, 0.01);
    expect(at).toBe(ref);
    // The walk's step and the floor query return primitives, never objects.
    expect(typeof slideStep(map, at, 0.01, 0)).toBe('boolean');
    expect(typeof floorAt(map, 2, 2, 0)).toBe('number');
  });
});

describe('where a Keeper put into a room stands (#381 W1)', () => {
  it('is deep in the Heart Hall, clear of the front wall the camera stops at', () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    const spot = startSpot(map, hall)!;
    expect(spot.y).toBe(hall.y0);
    expect(roomAt(map, spot)?.id).toBe(hall.id);
    // More than half way in: the follow camera has room behind it.
    expect(spot.z - hall.z0).toBeGreaterThan((hall.z1 - hall.z0) / 2);
    const pose = followPose(createFollowPose(), map, spot, Math.PI, hall, 0.5);
    expect(spot.z - pose.eye.z).toBeCloseTo(HOUSE_WALK.back);
  });

  it('steps aside from furniture standing there', () => {
    const plain = mapAt(1);
    const snug = room(plain, 'snug');
    const want = startSpot(plain, snug)!;
    const map = mapAt(1, [piece(want.x - 0.5, want.x + 0.5, want.z - 0.5, want.z + 0.5)]);
    const spot = startSpot(map, snug)!;
    expect(Number.isNaN(floorAt(map, spot.x, spot.z, 0))).toBe(false);
    expect(Math.hypot(spot.x - want.x, spot.z - want.z)).toBeGreaterThan(0.5);
  });
});

describe('the follow camera (#381 W1)', () => {
  const pose = () => createFollowPose();
  /** The camera's heading from looking straight in (+z), radians. */
  const heading = (p: ReturnType<typeof pose>) =>
    Math.atan2(p.target.x - p.eye.x, p.target.z - p.eye.z);

  it('stands behind the Keeper walking in, at kid height, looking down at it a little', () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    const at = { x: 4, z: 9, y: 0 };
    const p = followPose(pose(), map, at, Math.PI, hall, 0.5);
    expect(p.eye.x).toBeCloseTo(4);
    expect(p.eye.z).toBeCloseTo(9 - HOUSE_WALK.back);
    expect(p.eye.y).toBeCloseTo(HOUSE_WALK.eyeHeight);
    expect(p.target.z).toBeGreaterThan(at.z);
    expect(p.pitch).toBeGreaterThan(0);
    expect(p.pitch).toBeLessThan(25 * DEG);
  });

  it(`turns with the Keeper, never more than ${String(HOUSE_WALK.maxYaw)}° from looking in`, () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    const at = { x: 4.8, z: 9, y: 0 };
    let most = 0;
    for (let deg = -180; deg <= 180; deg += 5) {
      const yaw = deg * DEG;
      const turn = followTurn(yaw);
      expect(Math.abs(turn)).toBeLessThanOrEqual(HOUSE_WALK.maxYaw * DEG + 1e-9);
      const p = followPose(pose(), map, at, yaw, hall, 0.6);
      expect(Math.abs(heading(p))).toBeLessThanOrEqual(HOUSE_WALK.maxYaw * DEG + 1e-6);
      most = Math.max(most, Math.abs(heading(p)));
    }
    expect(most).toBeCloseTo(HOUSE_WALK.maxYaw * DEG, 3);
    // Heading east (yaw −90°: models face −z at 0), it turns toward +x.
    expect(followTurn(-Math.PI / 2)).toBeCloseTo(HOUSE_WALK.maxYaw * DEG);
    expect(followTurn(Math.PI / 2)).toBeCloseTo(-HOUSE_WALK.maxYaw * DEG);
    // Walking back toward the camera, it keeps looking straight in.
    expect(followTurn(0)).toBe(0);
    expect(followTurn(0.3)).toBe(0);
  });

  it('never stands in another room: inner rooms stop just inside their front and side walls', () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    expect(cameraFront(map, hall)).toBeCloseTo(hall.z0 + HOUSE_WALK.frontMargin);
    for (const rect of map.rects.filter((r) => r.room === hall.id && r.y === 0)) {
      for (let x = rect.x0; x <= rect.x1; x += 0.4) {
        for (let z = rect.z0; z <= rect.z1; z += 0.4) {
          for (const yaw of [Math.PI, Math.PI / 2, -Math.PI / 2, 2.5]) {
            const p = followPose(pose(), map, { x, z, y: 0 }, yaw, hall, 0.5);
            expect(p.eye.z).toBeGreaterThanOrEqual(hall.z0 + HOUSE_WALK.frontMargin - 1e-6);
            expect(p.eye.x).toBeGreaterThanOrEqual(hall.x0 + HOUSE_WALK.sideMargin - 1e-6);
            expect(p.eye.x).toBeLessThanOrEqual(hall.x1 - HOUSE_WALK.sideMargin + 1e-6);
            expect(p.eye.y).toBeLessThanOrEqual(hall.y1 - HOUSE_WALK.ceilingMargin + 1e-6);
          }
        }
      }
    }
  });

  it('keeps its heading when a side wall draws it in toward the Keeper', () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    // By the east wall heading west: behind it is east, where the wall is.
    const at = { x: hall.x1 - 1, z: 8, y: 0 };
    const p = followPose(pose(), map, at, Math.PI / 2, hall, 0.5);
    expect(heading(p)).toBeCloseTo(-HOUSE_WALK.maxYaw * DEG);
    expect(p.eye.x).toBeCloseTo(hall.x1 - HOUSE_WALK.sideMargin);
    expect(Math.hypot(p.eye.x - at.x, p.eye.z - at.z)).toBeLessThan(HOUSE_WALK.back);
  });

  it('rises and looks down when squeezed against an inner front wall', () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    const deep = followPose(pose(), map, { x: 4, z: 9, y: 0 }, Math.PI, hall, 0.5);
    const near = followPose(pose(), map, { x: 4, z: hall.z0 + 1.2, y: 0 }, Math.PI, hall, 0.5);
    expect(near.eye.z).toBeCloseTo(hall.z0 + HOUSE_WALK.frontMargin);
    expect(near.eye.y).toBeGreaterThan(deep.eye.y);
    expect(near.pitch).toBeGreaterThan(deep.pitch);
    // Right at the wall it still looks somewhere ahead, never straight down.
    const wall = followPose(pose(), map, { x: 4, z: hall.z0 + inset, y: 0 }, Math.PI, hall, 0.5);
    const span = Math.hypot(wall.target.x - wall.eye.x, wall.target.z - wall.eye.z);
    expect(span).toBeGreaterThanOrEqual(HOUSE_WALK.minSpan - 1e-6);
    expect(wall.pitch).toBeLessThan(85 * DEG);
  });

  it("lets a front room's camera stand out on the porch", () => {
    const map = mapAt(4);
    const snug = room(map, 'snug');
    expect(cameraFront(map, snug)).toBeCloseTo(snug.z0 - HOUSE_WALK.porchBack);
    const p = followPose(pose(), map, { x: 2.4, z: 1.2, y: 0 }, Math.PI, snug, 0.5);
    expect(p.eye.z).toBeCloseTo(1.2 - HOUSE_WALK.back);
    expect(p.eye.z).toBeLessThan(snug.z0);
    expect(p.eye.y).toBeCloseTo(HOUSE_WALK.eyeHeight);
  });

  it('stays under the ceiling of a one-storey room', () => {
    const map = mapAt(4);
    const kitchen = room(map, 'kitchen');
    // Upstairs in the Kitchen, right at its front: squeezed hard, it would climb into the roof.
    const at = { x: 2.4, z: kitchen.z0 + inset, y: kitchen.y0 };
    const p = followPose(pose(), map, at, Math.PI, kitchen, 0.5);
    expect(p.eye.y).toBeLessThanOrEqual(kitchen.y1 - HOUSE_WALK.ceilingMargin + 1e-6);
  });

  it('keeps clear of furniture right behind it (the low tier’s Kitchen table)', () => {
    const table = piece(1.6, 3.0, 1.4, 2.7, 0.85, HOUSE_GRID.storey);
    const map = mapAt(4, [table]);
    const kitchen = room(map, 'kitchen');
    // At the back, walking in: the camera's full step back would stand over the table.
    const at = { x: 2.3, z: kitchen.z1 - inset, y: kitchen.y0 };
    const p = followPose(pose(), map, at, Math.PI, kitchen, 0.5);
    const c = HOUSE_WALK.nearClear;
    const clear =
      p.eye.x <= table.x0 - c ||
      p.eye.x >= table.x1 + c ||
      p.eye.z <= table.z0 - c ||
      p.eye.z >= table.z1 + c;
    expect(clear).toBe(true);
    // Without the table it would have stood over it.
    const free = followPose(pose(), mapAt(4), at, Math.PI, kitchen, 0.5);
    expect(free.eye.z).toBeLessThan(p.eye.z);
    // Drawn in, it climbs a little to see over the Keeper.
    expect(p.eye.y).toBeGreaterThan(free.eye.y);
  });

  it('keeps the same horizontal view on a wide screen, and caps a tall phone’s vertical one', () => {
    const map = mapAt(1);
    const snug = room(map, 'snug');
    const at = { x: 2.4, z: 3, y: 0 };
    const phone = followPose(pose(), map, at, Math.PI, snug, 390 / 844);
    expect(phone.fov).toBeCloseTo(HOUSE_WALK.maxFov * DEG);
    const aspect = 1180 / 820;
    const wide = followPose(pose(), map, at, Math.PI, snug, aspect);
    const across = 2 * Math.atan(Math.tan(wide.fov / 2) * aspect);
    expect(across).toBeCloseTo(HOUSE_WALK.hfov * DEG);
  });

  it('eases toward its goal in place, and copies in place', () => {
    const map = mapAt(1);
    const snug = room(map, 'snug');
    const goal = followPose(pose(), map, { x: 2.4, z: 3, y: 0 }, Math.PI, snug, 0.5);
    const cam = copyPose(pose(), goal);
    expect(cam.eye).toEqual(goal.eye);
    cam.eye.x += 1;
    const ref = cam;
    expect(easePose(cam, goal, 0)).toBe(ref);
    expect(cam.eye.x).toBeCloseTo(goal.eye.x + 1);
    easePose(cam, goal, HOUSE_WALK.lag);
    // One lag closes 1 − 1/e of the gap.
    expect(cam.eye.x - goal.eye.x).toBeCloseTo(Math.exp(-1));
    for (let i = 0; i < 60; i += 1) easePose(cam, goal, 1 / 30);
    expect(cam.eye.x).toBeCloseTo(goal.eye.x, 2);
  });

  it('allocates nothing: it writes into the pose it was given', () => {
    const map = mapAt(4);
    const hall = room(map, 'heart-hall');
    const out = pose();
    const { eye, target } = out;
    expect(followPose(out, map, { x: 4, z: 9, y: 0 }, 2, hall, 0.5)).toBe(out);
    expect(out.eye).toBe(eye);
    expect(out.target).toBe(target);
  });
});
