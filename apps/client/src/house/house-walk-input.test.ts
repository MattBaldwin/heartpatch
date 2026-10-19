import { describe, expect, it } from 'vitest';
import { project, type HousePose } from './house-camera.js';
import { HOUSE_WALK } from './house-config.js';
import { createFollowPose, type FollowPose } from './house-walk.js';
import {
  createStickLatch,
  keeperTapped,
  releaseStick,
  stepToward,
  stickFrame,
  stickToFloor,
} from './house-walk-input.js';

/** A camera at the origin looking along `heading` (radians from +z). */
function looking(heading: number): FollowPose {
  const p = createFollowPose();
  p.eye.y = 1.7;
  p.target.x = Math.sin(heading) * 3;
  p.target.y = 0.5;
  p.target.z = Math.cos(heading) * 3;
  return p;
}

describe('the stick (#381 W2)', () => {
  it('walks the way the camera looks when pushed up, and to its right when pushed right', () => {
    const out = { x: 0, z: 0 };
    const ahead = stickToFloor(out, { x: 0, z: 1 }, looking(0));
    expect(ahead.x).toBeCloseTo(0);
    expect(ahead.z).toBeCloseTo(1);
    // Looking straight in (+z), right is +x (Babylon's left-handed world).
    const right = stickToFloor(out, { x: 1, z: 0 }, looking(0));
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
  });

  it('turns with the follow camera', () => {
    const out = { x: 0, z: 0 };
    const turn = 25 * (Math.PI / 180);
    const ahead = stickToFloor(out, { x: 0, z: 0.5 }, looking(turn));
    expect(ahead.x).toBeCloseTo(Math.sin(turn) * 0.5);
    expect(ahead.z).toBeCloseTo(Math.cos(turn) * 0.5);
  });

  it('walks straight in when the camera looks straight down', () => {
    const down = createFollowPose();
    down.eye.y = 5;
    down.target.x = 0;
    down.target.z = 0;
    const out = stickToFloor({ x: 0, z: 0 }, { x: 0, z: 1 }, down);
    expect(out.z).toBeCloseTo(1);
  });
});

describe('walking to a tapped spot (#381 W2)', () => {
  it('steps toward it, never past it, and stops once there', () => {
    const out = { x: 0, z: 0 };
    const at = { x: 0, z: 0, y: 0 };
    expect(stepToward(out, at, { x: 3, z: 4 }, 0.5)).toBe(true);
    expect(out.x).toBeCloseTo(0.3);
    expect(out.z).toBeCloseTo(0.4);
    expect(stepToward(out, at, { x: 0.2, z: 0 }, 0.5)).toBe(true);
    expect(out.x).toBeCloseTo(0.2);
    expect(stepToward(out, at, { x: HOUSE_WALK.arrive / 2, z: 0 }, 0.5)).toBe(false);
    expect(out).toEqual({ x: 0, z: 0 });
  });
});

describe('a tap on the Keeper in the dollhouse (#381 W2)', () => {
  const pose: HousePose = {
    eye: { x: 2.4, y: 9, z: -6 },
    target: { x: 2.4, y: 0, z: 2.4 },
    fov: 0.8,
    pitch: Math.atan2(9, 8.4),
  };
  const vp = { width: 390, height: 844 };
  const at = { x: 2, z: 3, y: 0 };
  const onScreen = () => {
    const p = project(pose, vp.width / vp.height, { x: at.x, y: 0.4, z: at.z });
    return { x: ((p.x + 1) / 2) * vp.width, y: ((1 - p.y) / 2) * vp.height };
  };

  it('hits within its tap radius of the Keeper’s middle', () => {
    const c = onScreen();
    expect(keeperTapped(pose, vp, at, 0.8, c.x, c.y)).toBe(true);
    expect(keeperTapped(pose, vp, at, 0.8, c.x + HOUSE_WALK.tapRadius - 2, c.y)).toBe(true);
  });

  it('misses further off, and a Keeper behind the camera', () => {
    const c = onScreen();
    expect(keeperTapped(pose, vp, at, 0.8, c.x + HOUSE_WALK.tapRadius + 4, c.y)).toBe(false);
    expect(keeperTapped(pose, vp, { x: 2.4, z: -9, y: 0 }, 0.8, c.x, c.y)).toBe(false);
  });

  it('is a big enough target (44 pt or more)', () => {
    expect(HOUSE_WALK.tapRadius * 2).toBeGreaterThanOrEqual(44);
  });
});

describe('the held stick’s camera (#381 W3)', () => {
  const pose = (z: number) => {
    const p = createFollowPose();
    p.eye.z = z;
    p.target.z = z + 1;
    return p;
  };

  it('steers from the camera as the hold began, until it’s let go', () => {
    const latch = createStickLatch();
    const cam = pose(0);
    expect(stickFrame(latch, true, cam).target.z).toBe(1);
    // The camera turns round mid-hold: the stick keeps the first one.
    cam.eye.z = 10;
    cam.target.z = 9;
    expect(stickFrame(latch, true, cam).target.z).toBe(1);
    // Let go (no stick this frame), then a new hold takes the camera afresh.
    stickFrame(latch, false, cam);
    expect(stickFrame(latch, true, cam).target.z).toBe(9);
  });

  it('takes the camera afresh after a release with no frame between (the house closed mid-hold)', () => {
    const latch = createStickLatch();
    stickFrame(latch, true, pose(0));
    releaseStick(latch);
    expect(stickFrame(latch, true, pose(5)).target.z).toBe(6);
  });

  it('writes into the latch it was given, in place', () => {
    const latch = createStickLatch();
    const held = latch.cam;
    expect(stickFrame(latch, true, pose(2))).toBe(held);
  });
});
