import {
  CROOKED_HOUSE,
  doorsOf,
  type CrookedDoor,
  type CrookedHouseView,
  type CrookedRoom,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { atticChestPoint, CROOKED_ATTIC } from './crooked-attic.js';
import { chestPoint, CROOKED_CHEST } from './crooked-bonus.js';
import {
  blocked,
  CROOKED_BODY,
  houseStep,
  PROP_FOOTPRINTS,
  roomFootprints,
  settle,
  tapWalk,
  LEANS_EAST,
  tiltOf,
  TOPPLE_TURNS,
  toppledYaw,
  walkPath,
  type Footprint,
} from './crooked-furniture.js';
import { prop, propNames } from './crooked-kit.js';
import {
  arrivalSpot,
  CROOKED_WALK,
  doorEnd,
  doorState,
  roomOf,
  roomStart,
  thingPoint,
  type FloorPoint,
} from './crooked-plan.js';

const room = (id: string) => {
  const r = roomOf(id);
  if (!r) throw new Error(id);
  return r;
};
const thing = (r: CrookedRoom, id: string) => {
  const t = r.things.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

const ALL_KEYED = CROOKED_HOUSE.doors.filter((d) => d.key !== undefined).map((d) => d.id);
const ALL_POWERED = CROOKED_HOUSE.doors.filter((d) => d.power !== undefined).map((d) => d.id);

/** A house view: `fixed` picks which things of each room are put right; doors open or shut. */
function viewOf(
  fixed: (r: CrookedRoom) => string[],
  open: boolean,
): Pick<CrookedHouseView, 'rooms' | 'unlocked' | 'bonusOpen' | 'keys'> {
  return {
    rooms: CROOKED_HOUSE.rooms
      .filter((r) => r.kind === 'main')
      .map((r) => ({ id: r.id, fixed: fixed(r), bloomed: false })),
    unlocked: open ? ALL_KEYED : [],
    bonusOpen: open ? ALL_POWERED : [],
    keys: [],
  };
}
const crooked = viewOf(() => [], true);
const putRight = viewOf((r) => r.things.map((t) => t.id), true);

const CLEAR = CROOKED_BODY.radius + CROOKED_BODY.pad;

/** How far a point is inside a footprint's own frame, as `[lx, lz]`. */
function local(f: Footprint, x: number, z: number): [number, number] {
  const dx = x - f.x;
  const dz = z - f.z;
  return [dx * f.cos - dz * f.sin, dx * f.sin + dz * f.cos];
}

describe('the Crooked House’s furniture footprints (#651)', () => {
  it('names every kit prop: a footprint or walkable, never forgotten', () => {
    for (const name of propNames()) expect(name in PROP_FOOTPRINTS, name).toBe(true);
  });

  /** Each thing's drawn mesh (`prop`), room-local, put right or crooked, as floor points and heights. */
  function drawn(r: CrookedRoom, t: CrookedRoom['things'][number], fixed: boolean) {
    const part = prop(t.prop, t.kind, fixed, 1, t.at, toppledYaw(t), tiltOf(t));
    part.bakeCurrentTransformIntoVertices();
    const pos = part.data.positions ?? [];
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      out.push({ x: r.box.x + (pos[i] ?? 0), y: pos[i + 1] ?? 0, z: r.box.z + (pos[i + 2] ?? 0) });
    }
    return out;
  }

  it('covers every solid prop as it is drawn: standing, knocked over or tilted', () => {
    for (const r of CROOKED_HOUSE.rooms) {
      for (const t of r.things) {
        for (const fixed of [true, false]) {
          const v = viewOf(() => (fixed ? [t.id] : []), true);
          const f = roomFootprints(r, v).find((x) => x.id === t.id);
          if (!f) continue;
          const label = `${t.id} ${fixed ? 'put right' : 'crooked'}`;
          for (const p of drawn(r, t, fixed)) {
            // A tilted thing's lean counts up to the Keeper's height.
            if (!fixed && t.kind === 'straighten' && p.y > CROOKED_BODY.tall) continue;
            const [lx, lz] = local(f, p.x, p.z);
            const slack = 0.02;
            const inside =
              lx >= f.x0 - slack && lx <= f.x1 + slack && lz >= f.z0 - slack && lz <= f.z1 + slack;
            expect(inside, label).toBe(true);
          }
        }
      }
    }
  });

  it('lets the Keeper walk only over things low enough to step over, on the wall, or overhead', () => {
    // The wall's things, the ceiling's mobile and the stairs, each for its own reason.
    const ABOVE = new Set(['picture', 'mirror', 'mobile', 'banister']);
    for (const r of CROOKED_HOUSE.rooms) {
      for (const t of r.things) {
        for (const fixed of [true, false]) {
          const v = viewOf(() => (fixed ? [t.id] : []), true);
          if (roomFootprints(r, v).some((x) => x.id === t.id)) continue;
          const label = `${t.id} ${fixed ? 'put right' : 'crooked'}`;
          if (ABOVE.has(t.prop)) continue;
          const top = Math.max(...drawn(r, t, fixed).map((p) => p.y));
          expect(top, label).toBeLessThanOrEqual(CROOKED_BODY.stepOver);
        }
      }
    }
    // The wall's things hang where the walls keep the Keeper off them; the mobile above its head.
    for (const r of CROOKED_HOUSE.rooms) {
      for (const t of r.things.filter((x) => x.prop === 'picture' || x.prop === 'mirror')) {
        const fromWall = Math.min(r.box.w / 2 - Math.abs(t.at[0]), r.box.d / 2 - Math.abs(t.at[1]));
        expect(fromWall, t.id).toBeLessThan(CROOKED_WALK.margin);
      }
      for (const t of r.things.filter((x) => x.prop === 'mobile')) {
        const low = Math.min(...drawn(r, t, true).map((p) => p.y));
        expect(low, t.id).toBeGreaterThan(CROOKED_BODY.tall);
      }
    }
  });

  it('turns and leans only things that fall or tilt, each named once in the house', () => {
    const lifts = CROOKED_HOUSE.rooms.flatMap((r) => r.things.filter((t) => t.kind === 'lift'));
    const ids = CROOKED_HOUSE.rooms.flatMap((r) => r.things.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of LEANS_EAST) {
      const t = CROOKED_HOUSE.rooms.flatMap((r) => r.things).find((x) => x.id === id);
      expect(t?.kind, id).toBe('straighten');
    }
    for (const id of Object.keys(TOPPLE_TURNS)) {
      expect(
        lifts.some((t) => t.id === id),
        id,
      ).toBe(true);
    }
  });

  it('leaves rugs and small things walkable, and blocks the kitchen counter and the table', () => {
    for (const name of ['runner', 'soup-bowl', 'yarn', 'banister']) {
      expect(PROP_FOOTPRINTS[name]).toBeNull();
    }
    const kitchen = room('kitchen');
    const tap = thingPoint(kitchen, thing(kitchen, 'tap'));
    expect(blocked(roomFootprints(kitchen, crooked), tap)).toBe(true);
    const dining = room('dining-room');
    const table = thingPoint(dining, thing(dining, 'tablecloth'));
    expect(blocked(roomFootprints(dining, crooked), table)).toBe(true);
  });
});

describe('the Keeper bumps into furniture (#651)', () => {
  /** Walks with the stick from `at` along `dir` (a unit step each frame) for `n` frames. */
  function push(r: CrookedRoom, at: FloorPoint, dir: FloorPoint, n = 120, v = crooked) {
    let p = at;
    for (let i = 0; i < n; i++) {
      p = houseStep(r, v, p, { x: p.x + dir.x * 0.08, z: p.z + dir.z * 0.08 }).at;
    }
    return p;
  }

  it('stops at the kitchen counter’s edge, pushing straight in', () => {
    const kitchen = room('kitchen');
    const tap = thingPoint(kitchen, thing(kitchen, 'tap'));
    const start = { x: tap.x, z: tap.z - 1.5 };
    const at = push(kitchen, start, { x: 0, z: 1 });
    const e = PROP_FOOTPRINTS['tap']!;
    expect(at.x).toBeCloseTo(tap.x);
    expect(at.z).toBeCloseTo(tap.z + e[1] - CLEAR);
    expect(blocked(roomFootprints(kitchen, crooked), at)).toBe(false);
  });

  it('stops at the dining table’s edge, and slides along it pushing in on a slant', () => {
    const dining = room('dining-room');
    const table = thingPoint(dining, thing(dining, 'tablecloth'));
    const e = PROP_FOOTPRINTS['tablecloth']!;
    const edge = table.z + e[1] - CLEAR;
    const straight = push(
      dining,
      { x: table.x - 0.3, z: table.z - 1.6 },
      { x: 0, z: 1 },
      20,
      putRight,
    );
    expect(straight.z).toBeCloseTo(edge);
    // North-east into its south side: it moves east along the edge, never in.
    const s = Math.SQRT1_2;
    let p = { x: table.x - 0.6, z: edge };
    for (let i = 0; i < 10; i++) {
      p = houseStep(dining, putRight, p, { x: p.x + s * 0.08, z: p.z + s * 0.08 }).at;
      expect(blocked(roomFootprints(dining, putRight), p)).toBe(false);
    }
    expect(p.x).toBeGreaterThan(table.x - 0.6 + 0.4);
    expect(p.z).toBeCloseTo(edge);
  });

  it('never ends a step inside furniture, from anywhere in any room', () => {
    for (const r of CROOKED_HOUSE.rooms) {
      for (const v of [crooked, putRight]) {
        const list = roomFootprints(r, v);
        for (let x = -r.box.w / 2; x <= r.box.w / 2; x += 0.2) {
          for (let z = -r.box.d / 2; z <= r.box.d / 2; z += 0.2) {
            const to = { x: r.box.x + x, z: r.box.z + z };
            const from = settle(r, v, roomStart(r));
            expect(blocked(list, houseStep(r, v, from, to).at), `${r.id} ${x} ${z}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('a tap-walk goes round furniture (#651)', () => {
  const walk = (r: CrookedRoom, from: FloorPoint, path: FloorPoint[], v = crooked) => {
    let p = from;
    for (const goal of path) {
      for (let i = 0; i < 400; i++) {
        const d = Math.hypot(goal.x - p.x, goal.z - p.z);
        if (d <= 0.05) break;
        const k = Math.min(1, 0.08 / d);
        const next = houseStep(r, v, p, {
          x: p.x + (goal.x - p.x) * k,
          z: p.z + (goal.z - p.z) * k,
        }).at;
        if (next.x === p.x && next.z === p.z) break;
        p = next;
      }
    }
    return p;
  };

  it('walks round the dining table to a spot behind it', () => {
    const dining = room('dining-room');
    const table = thingPoint(dining, thing(dining, 'tablecloth'));
    const from = { x: table.x, z: table.z - 1.2 };
    // North of the chairs tucked in on the far side.
    const goal = { x: table.x - 0.8, z: table.z + 2.0 };
    const path = walkPath(dining, putRight, from, goal);
    expect(path.length).toBeGreaterThan(1);
    const end = walk(dining, from, path, putRight);
    expect(Math.hypot(end.x - goal.x, end.z - goal.z)).toBeLessThan(0.1);
  });

  it('walks a tap on the counter to the nearest spot in front of it, in reach', () => {
    const kitchen = room('kitchen');
    const tap = thingPoint(kitchen, thing(kitchen, 'tap'));
    const fixed = viewOf((r) => (r.id === 'kitchen' ? ['tap'] : []), true);
    const from = { x: tap.x, z: tap.z - 2 };
    const path = walkPath(kitchen, fixed, from, tap);
    const end = walk(kitchen, from, path, fixed);
    expect(blocked(roomFootprints(kitchen, fixed), end)).toBe(false);
    expect(Math.hypot(end.x - tap.x, end.z - tap.z)).toBeLessThan(0.75);
  });

  it('walks a tap on the crooked table up beside it, close enough to put it right', () => {
    const dining = room('dining-room');
    const table = thingPoint(dining, thing(dining, 'tablecloth'));
    const from = settle(dining, crooked, roomStart(dining));
    const path = tapWalk(dining, crooked, from, { x: table.x + 0.3, z: table.z });
    const end = walk(dining, from, path);
    expect(Math.hypot(end.x - table.x, end.z - table.z)).toBeLessThanOrEqual(CROOKED_WALK.reach);
  });

  it('keeps a tap past an open doorway as the last point, so the walk steps through', () => {
    const hall = room('front-hall');
    const door = CROOKED_HOUSE.doors.find((d) => d.id === 'parlour-door')!;
    const end = doorEnd(door, 'front-hall')!;
    const past = { x: end.point.x - 0.6, z: end.point.z };
    const path = walkPath(hall, crooked, { x: 0, z: 0 }, past);
    expect(path.at(-1)).toEqual(past);
  });
});

/**
 * Every room, flood-filled from its start on a grid of real steps
 * (`houseStep`): every crooked thing, shut door, chest and doorway must be
 * in reach, and every spot the Keeper arrives at must be clear and joined
 * to the rest.
 */
describe('the furniture never traps the Keeper (#651)', () => {
  const STEP = 0.1;
  const DIRS: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  /** Flood-fills a lattice laid from the walls' margin (so its edge rows run along it), from the node nearest `start`. */
  function flood(r: CrookedRoom, v: ReturnType<typeof viewOf>, start: FloorPoint) {
    const ox = r.box.x - r.box.w / 2 + CROOKED_WALK.margin;
    const oz = r.box.z - r.box.d / 2 + CROOKED_WALK.margin;
    const at = (i: number, j: number) => ({ x: ox + i * STEP, z: oz + j * STEP });
    const i0 = Math.round((start.x - ox) / STEP);
    const j0 = Math.round((start.z - oz) / STEP);
    const first = at(i0, j0);
    const crossed = new Set<CrookedDoor>();
    const joined = houseStep(r, v, start, first).at;
    if (Math.abs(joined.x - first.x) > 1e-9 || Math.abs(joined.z - first.z) > 1e-9) {
      return { reached: [start], crossed };
    }
    const seen = new Set<string>([`${String(i0)},${String(j0)}`]);
    const reached: FloorPoint[] = [start, first];
    const queue: [number, number][] = [[i0, j0]];
    while (queue.length > 0) {
      const [i, j] = queue.shift()!;
      const from = at(i, j);
      for (const [di, dj] of DIRS) {
        const key = `${String(i + di)},${String(j + dj)}`;
        if (seen.has(key)) continue;
        const to = at(i + di, j + dj);
        const step = houseStep(r, v, from, to);
        if (step.crossed) crossed.add(step.crossed);
        if (Math.abs(step.at.x - to.x) > 1e-9 || Math.abs(step.at.z - to.z) > 1e-9) continue;
        seen.add(key);
        reached.push(to);
        queue.push([i + di, j + dj]);
      }
    }
    return { reached, crossed };
  }

  const near = (pts: FloorPoint[], p: FloorPoint, r: number) =>
    pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) <= r);

  const states: [string, ReturnType<typeof viewOf>][] = [
    ['all crooked, doors open', crooked],
    ['all put right, doors open', putRight],
    ['all crooked, doors shut', viewOf(() => [], false)],
    [
      'every other thing put right',
      viewOf((r) => r.things.filter((_, i) => i % 2 === 0).map((t) => t.id), true),
    ],
    [
      'the rest put right',
      viewOf((r) => r.things.filter((_, i) => i % 2 === 1).map((t) => t.id), true),
    ],
  ];

  for (const r of CROOKED_HOUSE.rooms) {
    it(`reaches everything in the ${r.name}`, () => {
      for (const [label, v] of states) {
        const list = roomFootprints(r, v);
        const start = settle(r, v, roomStart(r));
        expect(blocked(list, start), `${label}: start`).toBe(false);
        const { reached, crossed } = flood(r, v, start);
        const fixed = new Set(v.rooms.find((x) => x.id === r.id)?.fixed ?? []);
        for (const t of r.things) {
          if (fixed.has(t.id)) continue;
          // A little inside the reach, so the grid's spot really names it.
          const inReach = near(reached, thingPoint(r, t), CROOKED_WALK.reach - 0.1);
          expect(inReach, `${label}: ${t.id}`).toBe(true);
        }
        for (const door of doorsOf(CROOKED_HOUSE, r.id)) {
          const end = doorEnd(door, r.id);
          if (!end) continue;
          if (doorState(door, { ...v, keys: [] }).kind === 'open') {
            expect(crossed.has(door), `${label}: through ${door.id}`).toBe(true);
          } else {
            const inReach = near(reached, end.point, CROOKED_WALK.doorReach - 0.1);
            expect(inReach, `${label}: at ${door.id}`).toBe(true);
          }
          // Arriving through it lands clear, a step from the rest.
          const spot = settle(r, v, arrivalSpot(door, r.id)!);
          expect(blocked(list, spot), `${label}: arrive by ${door.id}`).toBe(false);
          expect(near(reached, spot, STEP * 1.5), `${label}: arrive by ${door.id}`).toBe(true);
        }
        if (r.kind === 'bonus') {
          expect(near(reached, chestPoint(r), CROOKED_CHEST.reach - 0.1), label).toBe(true);
        }
        if (r.kind === 'attic') {
          expect(near(reached, atticChestPoint(r), CROOKED_ATTIC.reach - 0.1), label).toBe(true);
        }
      }
    });
  }
});
