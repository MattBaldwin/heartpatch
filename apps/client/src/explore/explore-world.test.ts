import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EXPLORE_RULES, searchSpots } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { faceYaw } from '../procedural/face-yaw.js';
import { EXPLORE_CAMERA, EXPLORE_VIEW, INTERACTION } from './explore-config.js';
import { startInteraction } from './interactions.js';
import { clampToTile, insideTile } from './explore-view.js';
import {
  besideSpot,
  blocked,
  cameraGoal,
  cameraSettled,
  CAVE_STAGE,
  collidersOf,
  decorPlaces,
  cameraShot,
  followStep,
  freePoint,
  fromCaveStage,
  gapTo,
  hidingSpots,
  lanternGlint,
  LIGHT_REACH,
  offFacing,
  seededRandom,
  slideMove,
  spotAtTap,
  spotInFront,
  spotRadius,
  toCaveStage,
  yawToward,
} from './explore-world.js';

const spot = (index: number, x: number, z: number, done = false, kind = 'rock') => ({
  index,
  kind,
  tool: null,
  x,
  z,
  done,
});

/** Facing +z (away from the camera) and +x (the Keeper's face looks along its local −z). */
const AWAY = Math.PI;
const RIGHT = -Math.PI / 2;

/** The same heading, whichever way round the circle it's written. */
const turnBetween = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('colliders', () => {
  it('turns spots and buildings into circles', () => {
    const c = collidersOf([spot(0, 0.1, 0.2, true)], [{ x: -0.3, z: 0 }]);
    expect(c).toEqual([
      { x: 0.1, z: 0.2, r: spotRadius('rock') },
      { x: -0.3, z: 0, r: EXPLORE_VIEW.buildingRadius },
    ]);
    expect(spotRadius('pond')).toBeGreaterThan(spotRadius('rock'));
    expect(spotRadius('mystery')).toBe(EXPLORE_VIEW.spotRadiusDefault);
  });

  it('leaves room for the Keeper between two land spots `minGap` apart', () => {
    // The widest pair of land spots that can sit side by side; the pond is
    // wider, and the flood fill below checks every spot stays reachable.
    const widest = Math.max(
      ...Object.entries(EXPLORE_VIEW.spotRadius)
        .filter(([kind]) => kind !== 'pond')
        .map(([, r]) => r),
    );
    expect(2 * widest + 2 * EXPLORE_VIEW.keeperRadius).toBeLessThan(EXPLORE_RULES.placement.minGap);
  });

  it('can walk up to every spot from the start, on many generated tiles (pond included)', () => {
    const step = 0.005;
    const n = Math.ceil(2 / step) + 1;
    const at = (i: number) => -1 + i * step;
    let tiles = 0;
    for (const tile of generatedTiles(3)) {
      tiles++;
      const colliders = collidersOf(tile.spots, []);
      const free = (x: number, z: number) => insideTile({ x, z }) && !blocked({ x, z }, colliders);
      const start = freePoint(EXPLORE_VIEW.start, colliders);
      const seen = new Uint8Array(n * n);
      // The free grid cell nearest the start (its own cell may sit a hair inside a collider).
      const queue: number[] = [];
      let best = Infinity;
      for (let k = 0; k < n * n; k++) {
        const i = Math.floor(k / n);
        const j = k % n;
        const d = Math.hypot(at(i) - start.x, at(j) - start.z);
        if (d < best && d < step * 2 && free(at(i), at(j))) {
          best = d;
          queue[0] = k;
        }
      }
      for (const k of queue) seen[k] = 1;
      while (queue.length > 0) {
        const k = queue.pop() ?? 0;
        const i = Math.floor(k / n);
        const j = k % n;
        for (const [a, b] of [
          [i + 1, j],
          [i - 1, j],
          [i, j + 1],
          [i, j - 1],
        ] as const) {
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const next = a * n + b;
          if (seen[next] || !free(at(a), at(b))) continue;
          seen[next] = 1;
          queue.push(next);
        }
      }
      for (const spot of tile.spots) {
        const span = spotRadius(spot.kind) + EXPLORE_VIEW.keeperRadius + EXPLORE_VIEW.reach;
        let reached = false;
        for (let i = Math.max(0, Math.floor((spot.x - span + 1) / step)); !reached; i++) {
          if (i >= n || at(i) > spot.x + span) break;
          for (let j = Math.max(0, Math.floor((spot.z - span + 1) / step)); j < n; j++) {
            if (at(j) > spot.z + span) break;
            if (seen[i * n + j] && gapTo({ x: at(i), z: at(j) }, spot) <= EXPLORE_VIEW.reach) {
              reached = true;
              break;
            }
          }
        }
        expect(reached, `${tile.name}: spot ${String(spot.index)} (${spot.kind})`).toBe(true);
      }
    }
    expect(tiles).toBeGreaterThan(20);
  }, 30_000);

  it('never walks into a rock: it slides along it', () => {
    const rock = { x: 0, z: 0, r: 0.05 };
    const min = rock.r + EXPLORE_VIEW.keeperRadius;
    // Straight at it: stopped at its edge.
    const head = slideMove({ x: 0, z: -0.1 }, { x: 0, z: -0.07 }, [rock]);
    expect(Math.hypot(head.x, head.z)).toBeGreaterThanOrEqual(min - 1e-9);
    expect(blocked(head, [rock])).toBe(false);
    // A glancing step keeps going sideways round it.
    const from = { x: 0.01, z: -min - 0.001 };
    const slid = slideMove(from, { x: 0.03, z: -min + 0.02 }, [rock]);
    expect(blocked(slid, [rock])).toBe(false);
    expect(slid.x).toBeGreaterThan(from.x);
    // Open ground: straight there.
    expect(slideMove({ x: 0.5, z: 0 }, { x: 0.52, z: 0 }, [rock])).toEqual({ x: 0.52, z: 0 });
  });

  it('never steps further in one frame than a collider is wide', () => {
    const smallest = Math.min(
      ...Object.values(EXPLORE_VIEW.spotRadius),
      EXPLORE_VIEW.buildingRadius,
    );
    expect(EXPLORE_VIEW.walkSpeed * EXPLORE_VIEW.maxFrameStep).toBeLessThan(smallest);
  });

  it('stays put when squeezed between two', () => {
    const a = { x: -0.04, z: 0, r: 0.05 };
    const b = { x: 0.04, z: 0, r: 0.05 };
    const from = { x: 0, z: -0.2 };
    const to = slideMove(from, { x: 0, z: 0 }, [a, b]);
    expect(to).toEqual(from);
  });

  it('never starts inside a spot, on many generated tiles', () => {
    let tiles = 0;
    let moved = 0;
    for (const tile of generatedTiles(120)) {
      tiles++;
      const colliders = collidersOf(tile.spots, []);
      const start = freePoint(EXPLORE_VIEW.start, colliders);
      expect(blocked(start, colliders), tile.name).toBe(false);
      expect(insideTile(start), tile.name).toBe(true);
      if (start.x !== EXPLORE_VIEW.start.x || start.z !== EXPLORE_VIEW.start.z) {
        moved++;
        // A short step out, not across the tile.
        expect(
          Math.hypot(start.x - EXPLORE_VIEW.start.x, start.z - EXPLORE_VIEW.start.z),
        ).toBeLessThan(0.2);
      }
    }
    // The case is real: some generated tiles put a spot on the start.
    expect(moved).toBeGreaterThan(0);
    expect(tiles).toBeGreaterThan(200);
  });

  it('keeps the Keeper inside the tile while sliding', () => {
    const p = slideMove({ x: 0, z: 0 }, { x: 3, z: 0 }, []);
    expect(insideTile(p)).toBe(true);
  });
});

describe('what is in front of the Keeper', () => {
  it('faces the way it walks', () => {
    expect(turnBetween(yawToward({ x: 0, z: 0 }, { x: 0, z: 1 }), AWAY)).toBeCloseTo(0);
    expect(yawToward({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(RIGHT);
    expect(faceYaw(1, 0)).toBeCloseTo(-Math.PI / 2);
    expect(yawToward({ x: 0, z: 0 }, { x: -1, z: 0 })).toBeCloseTo(-RIGHT);
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(offFacing({ x: 0, z: 0 }, AWAY, { x: 0, z: 1 })).toBeCloseTo(0);
    expect(offFacing({ x: 0, z: 0 }, AWAY, { x: 0, z: -1 })).toBeCloseTo(Math.PI);
  });

  it('turns the face (local −z) the way the logic says it faces', () => {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.6, -0.8],
      [-0.3, 0.95],
    ] as const) {
      const m = new Matrix();
      Matrix.FromQuaternionToRef(Quaternion.RotationYawPitchRoll(faceYaw(dx, dz), 0, 0), m);
      const face = Vector3.TransformNormal(new Vector3(0, 0, -1), m);
      const len = Math.hypot(dx, dz);
      expect(face.x, `${String(dx)},${String(dz)}`).toBeCloseTo(dx / len);
      expect(face.z, `${String(dx)},${String(dz)}`).toBeCloseTo(dz / len);
    }
  });

  it('measures reach edge to edge', () => {
    const r = spotRadius('rock') + EXPLORE_VIEW.keeperRadius;
    expect(gapTo({ x: 0, z: 0 }, spot(0, r + 0.02, 0))).toBeCloseTo(0.02);
  });

  it('offers the spot in reach the Keeper faces, not one behind it', () => {
    const close = spotRadius('rock') + EXPLORE_VIEW.keeperRadius + 0.01;
    const ahead = spot(1, 0, close);
    const behind = spot(2, 0, -close);
    expect(spotInFront({ x: 0, z: 0 }, AWAY, [ahead, behind], null)?.index).toBe(1);
    expect(spotInFront({ x: 0, z: 0 }, 0, [ahead, behind], null)?.index).toBe(2);
    // Off to the side, past the facing cone: nothing.
    expect(spotInFront({ x: 0, z: 0 }, RIGHT + Math.PI, [ahead], null)).toBeNull();
    // Out of reach, or searched: nothing.
    expect(spotInFront({ x: 0, z: 0 }, AWAY, [spot(3, 0, 0.5)], null)).toBeNull();
    expect(spotInFront({ x: 0, z: 0 }, AWAY, [spot(4, 0, close, true)], null)).toBeNull();
  });

  it('prefers the one most nearly ahead', () => {
    const close = spotRadius('rock') + EXPLORE_VIEW.keeperRadius + 0.01;
    const straight = spot(1, 0, close);
    const aside = spot(2, close * 0.7, close * 0.7);
    expect(spotInFront({ x: 0, z: 0 }, AWAY, [aside, straight], null)?.index).toBe(1);
  });

  it('lets the tapped spot win while it is in reach', () => {
    const close = spotRadius('rock') + EXPLORE_VIEW.keeperRadius + 0.01;
    const ahead = spot(1, 0, close);
    const behind = spot(2, 0, -close);
    expect(spotInFront({ x: 0, z: 0 }, AWAY, [ahead, behind], 2)?.index).toBe(2);
    // Searched already: back to the one in front.
    expect(spotInFront({ x: 0, z: 0 }, AWAY, [ahead, { ...behind, done: true }], 2)?.index).toBe(1);
  });

  it('picks a tapped spot and stands beside it, in reach and clear of it', () => {
    const rock = spot(0, 0.2, 0);
    expect(spotAtTap({ x: 0.22, z: 0.02 }, [rock])?.index).toBe(0);
    expect(spotAtTap({ x: 0.5, z: 0 }, [rock])).toBeNull();
    const at = besideSpot({ x: -0.6, z: 0 }, rock);
    expect(at.x).toBeLessThan(0.2);
    expect(gapTo(at, rock)).toBeGreaterThan(0);
    expect(gapTo(at, rock)).toBeLessThanOrEqual(EXPLORE_VIEW.reach);
    expect(blocked(at, collidersOf([rock], []))).toBe(false);
    expect(spotInFront(at, yawToward(at, rock), [rock], null)?.index).toBe(0);
  });
  it('stands round the other side when a neighbour is in the way', () => {
    const rock = spot(0, 0, 0);
    const keep = spotRadius('rock') + EXPLORE_VIEW.keeperRadius + EXPLORE_VIEW.reach * 0.4;
    // A neighbour sits right where the Keeper would stand (coming from the left).
    const neighbour = spot(1, -keep - 0.02, 0);
    const colliders = collidersOf([rock, neighbour], []);
    const at = besideSpot({ x: -0.6, z: 0 }, rock, colliders);
    expect(blocked(at, colliders)).toBe(false);
    expect(gapTo(at, rock)).toBeLessThanOrEqual(EXPLORE_VIEW.reach);
    // Near the tile's edge: still inside it and in reach.
    const edge = spot(2, 0.8, 0);
    const there = besideSpot({ x: 0.95, z: 0 }, edge, collidersOf([edge], []));
    expect(insideTile(there)).toBe(true);
    expect(gapTo(there, edge)).toBeLessThanOrEqual(EXPLORE_VIEW.reach);
  });
});

describe('the follow camera', () => {
  it('looks a little ahead of the Keeper', () => {
    const goal = cameraGoal({ x: 0, z: 0 });
    expect(goal.x).toBeCloseTo(0);
    expect(goal.z).toBeCloseTo(EXPLORE_CAMERA.lookAhead);
  });

  it('keeps the Keeper near the middle even at the tile edge (it stays on a phone screen)', () => {
    for (const angle of [0, 0.7, 1.5, 2.6, 3.4, 4.7, 5.6]) {
      const keeper = clampToTile({ x: Math.cos(angle), z: Math.sin(angle) });
      const goal = cameraGoal(keeper);
      // About 1 world unit: well inside a portrait phone's half-width at the Keeper.
      expect(Math.abs(goal.x - keeper.x), `angle ${String(angle)}`).toBeLessThan(0.14);
    }
  });

  it('frames the Keeper and the spot together while a tool is in use', () => {
    const goal = cameraGoal({ x: 0, z: 0 }, { x: 0.1, z: -0.1 });
    expect(goal.x).toBeCloseTo(0.05);
    expect(goal.z).toBeCloseTo(-0.05 + EXPLORE_CAMERA.lookAhead);
  });

  it('follows the Keeper itself while the lantern is lit, not the cave', () => {
    const goal = cameraGoal({ x: 0.1, z: 0 }, { x: -0.3, z: 0.3 }, true);
    expect(goal.x).toBeCloseTo(0.1);
    expect(goal.z).toBeCloseTo(EXPLORE_CAMERA.lightLookAhead);
  });

  it('clamps to the tile, short of its edge', () => {
    const goal = cameraGoal({ x: 0.8, z: 0 });
    expect(goal.x).toBeLessThan(0.8);
    expect(insideTile(goal, EXPLORE_CAMERA.edgeMargin)).toBe(true);
    expect(cameraGoal({ x: -0.8, z: 0 }).x).toBeCloseTo(-goal.x);
  });

  it('eases towards the goal and settles exactly on it', () => {
    const goal = { target: { x: 0.3, z: 0.1 }, zoom: EXPLORE_CAMERA.nudge };
    let cam = { target: { x: 0, z: 0 }, zoom: 1 };
    cam = followStep(cam, goal, 1 / 60);
    expect(cam.target.x).toBeGreaterThan(0);
    expect(cam.target.x).toBeLessThan(0.3);
    expect(cam.zoom).toBeLessThan(1);
    expect(cameraSettled(cam, goal)).toBe(false);
    for (let i = 0; i < 200 && !cameraSettled(cam, goal); i++) cam = followStep(cam, goal, 1 / 60);
    expect(cameraSettled(cam, goal)).toBe(true);
    // No time, no move.
    const still = { target: { x: 0, z: 0 }, zoom: 1 };
    expect(followStep(still, goal, 0)).toEqual(still);
  });
});

describe('props in the way', () => {
  const tall = (kind: string) => (kind === 'tree' ? 0.3 : 0.02);
  const middle = 0.07;
  const pitch = cameraShot(0.46).pitch;

  it('fades a tall prop between the camera and the Keeper, and only that', () => {
    const keeper = { x: 0, z: 0 };
    const spots = [
      spot(0, 0, -0.15, false, 'tree'), // in front, on its line: hides it
      spot(1, 0, 0.15, false, 'tree'), // behind it: never in the way
      spot(2, 0.4, -0.15, false, 'tree'), // off to the side
      spot(3, 0, -0.1, false, 'mound'), // low: the Keeper shows over it
      spot(4, 0, -0.9, false, 'tree'), // far in front: the camera looks over it
      spot(5, 0.09, 0, false, 'tree'), // level with it, beside it
    ];
    expect([...hidingSpots(keeper, spots, pitch, tall, middle)]).toEqual([0]);
  });

  it('looks flatter on a phone held upright than on a tablet', () => {
    expect(cameraShot(0.46).pitch).toBeLessThan(cameraShot(0.7).pitch);
    expect(cameraShot(0.1)).toEqual(cameraShot(EXPLORE_CAMERA.phone.aspect));
    expect(cameraShot(2)).toEqual(cameraShot(EXPLORE_CAMERA.tablet.aspect));
  });
});

describe('decor', () => {
  it('grows the same decor on the same tile, clear of the spots', () => {
    const colliders = collidersOf([spot(0, 0, 0), spot(1, 0.3, 0.3)], []);
    const a = decorPlaces({ q: 2, r: -1 }, colliders);
    const b = decorPlaces({ q: 2, r: -1 }, colliders);
    expect(a).toEqual(b);
    expect(a.tufts.length).toBeGreaterThan(10);
    expect(a.pebbles.length).toBeGreaterThan(0);
    expect(a.flowers.length).toBeGreaterThan(0);
    for (const p of [...a.tufts, ...a.pebbles, ...a.flowers]) {
      expect(insideTile(p, 0)).toBe(true);
      expect(blocked(p, colliders, 0)).toBe(false);
    }
    expect(decorPlaces({ q: 0, r: 0 }, colliders)).not.toEqual(a);
  });

  it('has a seeded RNG in 0–1', () => {
    const r = seededRandom(42);
    const seq = [r(), r(), r()];
    expect(seq.every((x) => x >= 0 && x < 1)).toBe(true);
    const again = seededRandom(42);
    expect([again(), again(), again()]).toEqual(seq);
  });
});

describe('the lantern', () => {
  it('hides its glint on the tile, where the Keeper can stand within the light', () => {
    let caves = 0;
    for (const tile of generatedTiles(40)) {
      const colliders = collidersOf(tile.spots, []);
      for (const cave of tile.spots.filter((s) => s.kind === 'cave')) {
        for (const seed of [0, 0.13, 0.37, 0.5, 0.71, 0.99]) {
          caves++;
          const picked = startInteraction('light', CAVE_STAGE, 0, seed).glint;
          const glint = fromCaveStage(cave, lanternGlint(cave, picked, colliders));
          const where = `${tile.name} cave ${String(cave.index)} seed ${String(seed)}`;
          expect(insideTile(glint), where).toBe(true);
          const stand = freePoint(glint, colliders);
          expect(blocked(stand, colliders), where).toBe(false);
          expect(Math.hypot(stand.x - glint.x, stand.z - glint.z), where).toBeLessThanOrEqual(
            LIGHT_REACH,
          );
        }
      }
    }
    expect(caves).toBeGreaterThan(20);
  });

  it('maps the cave stage to the tile and back', () => {
    const cave = { x: 0.2, z: -0.1 };
    expect(toCaveStage(cave, cave)).toEqual({
      x: CAVE_STAGE.width / 2,
      y: CAVE_STAGE.height / 2,
    });
    const p = { x: 0.25, z: 0 };
    const back = fromCaveStage(cave, toCaveStage(cave, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.z).toBeCloseTo(p.z);
    // Further from the camera is up the stage (screen-like).
    expect(toCaveStage(cave, { x: 0.2, z: 0 }).y).toBeLessThan(CAVE_STAGE.height / 2);
    // The light on the ground is about the Keeper's own glow.
    expect(INTERACTION.lightRadius * INTERACTION.caveArea).toBeGreaterThan(
      EXPLORE_VIEW.keeperRadius * 2,
    );
  });
});

/** Tiles laid out by the server's own rules (`searchSpots`), every explorable terrain. */
function* generatedTiles(
  seeds: number,
): Generator<{ name: string; spots: ReturnType<typeof searchSpots> & object }> {
  for (let s = 0; s < seeds; s++) {
    for (const { terrain } of EXPLORE_RULES.terrains) {
      for (const [q, r] of [
        [0, 0],
        [2, -1],
      ] as const) {
        const spots = searchSpots(`seed-${String(s)}`, { q, r, terrain }, EXPLORE_RULES);
        if (spots && spots.length > 0)
          yield { name: `seed-${String(s)} ${terrain} ${String(q)},${String(r)}`, spots };
      }
    }
  }
}
