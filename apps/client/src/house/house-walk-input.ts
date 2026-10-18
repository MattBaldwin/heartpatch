import { project, type HousePose, type HouseViewport } from './house-camera.js';
import { HOUSE_WALK } from './house-config.js';
import type { FollowPose, WalkSpot } from './house-walk.js';

/*
 * Walking the Keeper about the house by touch (#381 W2), pure: the stick's
 * push turned to the floor the camera looks across, a step toward a tapped
 * spot, and a tap on the Keeper in the dollhouse. The screen (house-screen.ts)
 * feeds it the pointers; nothing here allocates per frame.
 */

/** A direction across the floor, metres (or a share of the stick's push). */
export interface FloorStep {
  x: number;
  z: number;
}

/**
 * The stick's push (`joystickVector`: x right, z up the screen) as a
 * direction across the floor, written into `out`: up walks the way the
 * camera looks, right walks to its right.
 */
export function stickToFloor(
  out: FloorStep,
  push: Readonly<FloorStep>,
  cam: FollowPose,
): FloorStep {
  const fx = cam.target.x - cam.eye.x;
  const fz = cam.target.z - cam.eye.z;
  const l = Math.hypot(fx, fz);
  // Looking straight down there's no forward: walk as from the dollhouse (+z in).
  const ux = l > 1e-6 ? fx / l : 0;
  const uz = l > 1e-6 ? fz / l : 1;
  // Left-handed (Babylon): the right of forward (ux, uz) is (uz, −ux).
  out.x = uz * push.x + ux * push.z;
  out.z = -ux * push.x + uz * push.z;
  return out;
}

/**
 * The next step toward a tapped spot, at most `step` metres, written into
 * `out`; false once the Keeper is there (within `HOUSE_WALK.arrive`).
 */
export function stepToward(
  out: FloorStep,
  at: Readonly<WalkSpot>,
  to: Readonly<FloorStep>,
  step: number,
): boolean {
  const dx = to.x - at.x;
  const dz = to.z - at.z;
  const d = Math.hypot(dx, dz);
  if (d <= HOUSE_WALK.arrive) {
    out.x = 0;
    out.z = 0;
    return false;
  }
  const k = Math.min(1, step / d);
  out.x = dx * k;
  out.z = dz * k;
  return true;
}

/**
 * A tap at (x, y) CSS px lands on the Keeper as `pose` sees it: within
 * `HOUSE_WALK.tapRadius` of its middle (`tall` metres high, standing at `at`).
 */
export function keeperTapped(
  pose: HousePose,
  vp: Pick<HouseViewport, 'width' | 'height'>,
  at: Readonly<WalkSpot>,
  tall: number,
  x: number,
  y: number,
): boolean {
  const w = Math.max(1, vp.width);
  const h = Math.max(1, vp.height);
  const p = project(pose, w / h, { x: at.x, y: at.y + tall / 2, z: at.z });
  if (p.depth <= 0) return false;
  const sx = ((p.x + 1) / 2) * w;
  const sy = ((1 - p.y) / 2) * h;
  return Math.hypot(sx - x, sy - y) <= HOUSE_WALK.tapRadius;
}
