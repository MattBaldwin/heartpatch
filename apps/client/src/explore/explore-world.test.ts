import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EXPLORE_RULES, searchSpots } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { loftRoundedHex } from '../map/hex-mesh.js';
import { TERRAIN_LOOKS, TILE_FILL } from '../map/map-config.js';
import { CORNER, DOME, SEGMENTS, TOP_RINGS } from '../map/map-scene.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { EXPLORE_CAMERA, EXPLORE_VIEW, INTERACTION } from './explore-config.js';
import { startInteraction } from './interactions.js';
import { clampToTile, insideTile } from './explore-view.js';
import {
  alongTrail,
  besideSpot,
  blocked,
  cameraGoal,
  cameraSettled,
  CAVE_STAGE,
  collidersOf,
  decorPlaces,
  cameraShot,
  followLead,
  followStep,
  freePoint,
  fromCaveStage,
  gapTo,
  hidingSpots,
  keepClear,
  lanternGlint,
  LIGHT_REACH,
  LIGHT_RING_SHARE,
  lightCircle,
  offFacing,
  seededRandom,
  slideMove,
  spotAtTap,
  spotInFront,
  spotRadius,
  tileSurface,
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
  it('draws its light round the whole Keeper, holding the reveal ring in its warm part', () => {
    // A ground ring squashed by the camera's tilt, the Keeper standing in it.
    const ring = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return { x: 200 + Math.cos(a) * 90, y: 500 + Math.sin(a) * 45 };
    });
    const feet = { x: 200, y: 500 };
    const head = { x: 200, y: 330 };
    const c = lightCircle(ring, feet, head);
    for (const p of [...ring, feet, head]) {
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThanOrEqual(c.r * LIGHT_RING_SHARE + 1e-9);
    }
    // Centred on the Keeper, between its feet and its hair.
    expect(c.y).toBeLessThan(feet.y);
    expect(c.y).toBeGreaterThan(head.y);
  });

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

describe("the tile's top", () => {
  const h = TERRAIN_LOOKS['meadow']?.height ?? 0.2;
  const rings = TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h }));
  // The explore tile exactly as the scene lofts it, at tile-local size.
  const mesh = loftRoundedHex(TILE_FILL, [...rings, { scale: 1, y: 0 }], {
    corner: CORNER,
    segments: SEGMENTS,
    centre: { y: h + DOME },
  });
  const surface = tileSurface({
    radius: TILE_FILL,
    corner: CORNER,
    segments: SEGMENTS,
    centre: h + DOME,
    rings,
  });
  /** The highest triangle of the mesh over a point (barycentric). */
  const meshHeight = (x: number, z: number): number => {
    const p = mesh.positions;
    const ix = mesh.indices;
    let best = -Infinity;
    for (let t = 0; t < ix.length; t += 3) {
      const [a, b, c] = [ix[t] ?? 0, ix[t + 1] ?? 0, ix[t + 2] ?? 0].map((i) => i * 3) as [
        number,
        number,
        number,
      ];
      const [ax, az, bx, bz, cx, cz] = [a, a + 2, b, b + 2, c, c + 2].map((i) => p[i] ?? 0) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      best = Math.max(best, l1 * (p[a + 1] ?? 0) + l2 * (p[b + 1] ?? 0) + l3 * (p[c + 1] ?? 0));
    }
    return best;
  };
  // World units over map units, as the scene scales the tile.
  const k = EXPLORE_VIEW.hexSize / 0.65;

  it('puts feet on the lofted top: the start, x = 0.5, the walk limit and a corner', () => {
    const places = {
      start: EXPLORE_VIEW.start,
      middle: { x: 0, z: 0 },
      'x 0.5': { x: 0.5, z: 0 },
      'flat side, walk limit': clampToTile({ x: 2, z: 0 }),
      'corner, walk limit': clampToTile({ x: 0, z: 2 }),
      'between, walk limit': clampToTile({ x: 1.4, z: 1.4 }),
    };
    for (const [name, p] of Object.entries(places)) {
      const under = meshHeight(p.x, p.z);
      expect(under, `${name} is on the tile`).toBeGreaterThan(-Infinity);
      // Within 0.03 world units of the surface (the Keeper is about 1.2 tall).
      expect(Math.abs(surface(p) - under) * k, name).toBeLessThan(0.03);
    }
  });

  it('never walks off the rounded rim', () => {
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      const p = clampToTile({ x: Math.cos(a) * 2, z: Math.sin(a) * 2 });
      expect(meshHeight(p.x, p.z), `angle ${String(a)}`).toBeGreaterThan(-Infinity);
    }
  });

  it('stands props and decor on it, out to the rim', () => {
    let checked = 0;
    for (const tile of generatedTiles(10)) {
      const colliders = collidersOf(tile.spots, []);
      const decor = decorPlaces({ q: 3, r: -2 }, colliders);
      for (const p of [...tile.spots, ...decor.tufts, ...decor.pebbles, ...decor.flowers]) {
        checked++;
        expect(
          Math.abs(surface(p) - meshHeight(p.x, p.z)) * k,
          `${tile.name} ${JSON.stringify(p)}`,
        ).toBeLessThan(0.03);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('following along the trail (#317)', () => {
  const trail = [
    { x: 0, z: -0.1 },
    { x: 0.1, z: -0.1 },
  ];
  const along = (back: number) => {
    const out = { x: 9, z: 9 };
    alongTrail({ x: 0, z: 0 }, trail, back, out);
    return out;
  };

  it('finds the point that far back along the path the Keeper walked', () => {
    expect(along(0.05)).toEqual({ x: 0, z: -0.05 });
    const corner = along(0.15);
    expect(corner.x).toBeCloseTo(0.05);
    expect(corner.z).toBeCloseTo(-0.1);
  });

  it("stops at the trail's end, and stays put with no trail", () => {
    expect(along(1)).toEqual({ x: 0.1, z: -0.1 });
    const out = { x: 9, z: 9 };
    alongTrail({ x: 0.3, z: 0.2 }, [], 0.1, out);
    expect(out).toEqual({ x: 0.3, z: 0.2 });
  });

  it('moves a follower smoothly as the Keeper walks, never jumping', () => {
    const out = { x: 0, z: 0 };
    let last: { x: number; z: number } | null = null;
    for (let i = 0; i <= 20; i++) {
      const at = { x: 0, z: i * 0.005 };
      alongTrail(
        at,
        [
          { x: 0, z: 0 },
          { x: 0, z: -0.2 },
        ],
        0.09,
        out,
      );
      if (last) expect(Math.hypot(out.x - last.x, out.z - last.z)).toBeLessThan(0.0051);
      last = { ...out };
    }
  });
});

describe('the team never covers the Keeper (#323)', () => {
  const pitch = EXPLORE_CAMERA.phone.pitch;
  const tall = 0.06; // a squishy about 0.42 world units tall

  it("keeps a follower on the camera's side low enough on screen", () => {
    const lead = followLead(tall, pitch);
    // The camera's line over the follower's top meets the ground at the
    // Keeper's front edge, not past it.
    const reach = lead - tall / Math.tan(pitch);
    expect(reach).toBeCloseTo(EXPLORE_VIEW.keeperRadius);
    // A steeper camera (the tablet) lets them come closer.
    expect(followLead(tall, EXPLORE_CAMERA.tablet.pitch)).toBeLessThan(lead);
  });

  it('pushes a follower straight out of the way, and leaves one already clear', () => {
    const k = { x: 0, z: 0 };
    const near = { x: 0.03, z: -0.04 };
    keepClear(k, near, 0.1);
    expect(Math.hypot(near.x, near.z)).toBeCloseTo(0.1);
    expect(near.x / near.z).toBeCloseTo(0.03 / -0.04);
    const far = { x: 0.2, z: 0 };
    keepClear(k, far, 0.1);
    expect(far).toEqual({ x: 0.2, z: 0 });
    // Right on top of the Keeper: away from the camera, behind it.
    const on = { x: 0, z: 0 };
    keepClear(k, on, 0.1);
    expect(on).toEqual({ x: 0, z: 0.1 });
  });

  it('keeps every follower clear while the Keeper walks away and then turns back to the camera', () => {
    const gap = EXPLORE_VIEW.followGap;
    const lead = followLead(tall, pitch);
    const backs = [0, 1, 2].map((i) => Math.max(lead, 1.5 * gap) + i * gap);
    // The scene's trail: a new point once the Keeper is a gap from the last.
    let trail = [0, 1, 2, 3].map((n) => ({ x: 0, z: (n + 1) * gap }));
    const followers = backs.map(() => ({ x: 0, z: 0 }));
    const walk = [
      ...Array.from({ length: 60 }, () => 0.005), // away from the camera (+z)
      ...Array.from({ length: 60 }, () => -0.005), // back towards it
    ];
    let at = { x: 0, z: 0 };
    for (const dz of walk) {
      at = { x: at.x, z: at.z + dz };
      const head = trail[0]!;
      if (Math.hypot(head.x - at.x, head.z - at.z) >= gap) trail = [at, ...trail].slice(0, 5);
      followers.forEach((f, i) => {
        alongTrail(at, trail, backs[i]!, f);
        keepClear(at, f, lead);
        // Never closer than `lead`, so one on the camera's side stays below the Keeper's feet.
        expect(Math.hypot(f.x - at.x, f.z - at.z)).toBeGreaterThanOrEqual(lead - 1e-9);
      });
    }
    // Walking towards the camera, the team ends up behind the Keeper.
    for (const f of followers) expect(f.z).toBeGreaterThan(at.z);
  });
});
