import { describe, expect, it } from 'vitest';
import { EXPLORE_CAMERA, EXPLORE_VIEW, INTERACTION } from './explore-config.js';
import { insideTile } from './explore-view.js';
import {
  besideSpot,
  blocked,
  cameraGoal,
  cameraSettled,
  CAVE_STAGE,
  collidersOf,
  decorPlaces,
  followStep,
  fromCaveStage,
  gapTo,
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

/** Facing +z (away from the camera), +x and −x. */
const AWAY = Math.PI;
const RIGHT = Math.PI / 2;

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

  it('leaves room for the Keeper between two spots `minGap` apart', () => {
    // The widest pair of land spots that can sit side by side (not the pond).
    const widest = Math.max(
      ...Object.entries(EXPLORE_VIEW.spotRadius)
        .filter(([kind]) => kind !== 'pond')
        .map(([, r]) => r),
    );
    expect(2 * widest + 2 * EXPLORE_VIEW.keeperRadius).toBeLessThan(0.16 + 0.04);
  });

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

  it('stays put when squeezed between two', () => {
    const a = { x: -0.04, z: 0, r: 0.05 };
    const b = { x: 0.04, z: 0, r: 0.05 };
    const from = { x: 0, z: -0.2 };
    const to = slideMove(from, { x: 0, z: 0 }, [a, b]);
    expect(blocked(to, [a, b])).toBe(false);
  });

  it('keeps the Keeper inside the tile while sliding', () => {
    const p = slideMove({ x: 0, z: 0 }, { x: 3, z: 0 }, []);
    expect(insideTile(p)).toBe(true);
  });
});

describe('what is in front of the Keeper', () => {
  it('faces the way it walks', () => {
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: 1 })).toBeCloseTo(AWAY);
    expect(yawToward({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(RIGHT);
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(offFacing({ x: 0, z: 0 }, AWAY, { x: 0, z: 1 })).toBeCloseTo(0);
    expect(offFacing({ x: 0, z: 0 }, AWAY, { x: 0, z: -1 })).toBeCloseTo(Math.PI);
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
});

describe('the follow camera', () => {
  it('looks a little ahead of the Keeper', () => {
    const goal = cameraGoal({ x: 0, z: 0 });
    expect(goal.x).toBeCloseTo(0);
    expect(goal.z).toBeCloseTo(EXPLORE_CAMERA.lookAhead);
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
