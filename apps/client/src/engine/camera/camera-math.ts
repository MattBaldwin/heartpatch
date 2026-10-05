/**
 * Pure maths for the map camera: no Babylon, no DOM, so it unit-tests in Node.
 *
 * Coordinates are Babylon's left-handed world: x right, y up, z "north". The
 * camera orbits a target point on the ground (y = 0) at a fixed pitch and yaw;
 * the player only moves the target (pan) and the distance (zoom).
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A point on the ground plane (y = 0). */
export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface CameraPose {
  readonly target: GroundPoint;
  readonly distance: number;
  /** Tilt down from the horizon, radians. */
  readonly pitch: number;
  readonly yaw: number;
  /** Vertical field of view, radians. */
  readonly fov: number;
  /** Viewport width / height. */
  readonly aspect: number;
}

export interface CameraBasis {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

export const ZERO: GroundPoint = { x: 0, z: 0 };

export function cameraBasis(pitch: number, yaw: number): CameraBasis {
  const cp = Math.cos(pitch);
  const forward = { x: Math.sin(yaw) * cp, y: -Math.sin(pitch), z: Math.cos(yaw) * cp };
  // right = worldUp × forward, normalised (left-handed); up = forward × right.
  const len = Math.hypot(forward.z, forward.x) || 1;
  const right = { x: forward.z / len, y: 0, z: -forward.x / len };
  const up = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };
  return { forward, right, up };
}

/** Where the camera sits: back along `forward` from the target. */
export function cameraPosition(pose: CameraPose): Vec3 {
  const { forward } = cameraBasis(pose.pitch, pose.yaw);
  return {
    x: pose.target.x - forward.x * pose.distance,
    y: -forward.y * pose.distance,
    z: pose.target.z - forward.z * pose.distance,
  };
}

/**
 * The ground point under a screen point, given in normalised device
 * coordinates (-1..1, y up). Null if that ray never reaches the ground (only
 * possible near the horizon with a shallow pitch).
 */
export function groundAt(pose: CameraPose, ndcX: number, ndcY: number): GroundPoint | null {
  const { forward, right, up } = cameraBasis(pose.pitch, pose.yaw);
  const h = Math.tan(pose.fov / 2);
  const sx = ndcX * h * pose.aspect;
  const sy = ndcY * h;
  const dir = {
    x: forward.x + right.x * sx + up.x * sy,
    y: forward.y + right.y * sx + up.y * sy,
    z: forward.z + right.z * sx + up.z * sy,
  };
  if (dir.y >= -1e-6) return null;
  const origin = cameraPosition(pose);
  const t = -origin.y / dir.y;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}

/** CSS pixel position inside a viewport → normalised device coordinates. */
export function toNdc(
  px: number,
  py: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (px / width) * 2 - 1, y: 1 - (py / height) * 2 };
}

export function clampTarget(p: GroundPoint, b: Bounds): GroundPoint {
  return {
    x: Math.min(b.maxX, Math.max(b.minX, p.x)),
    z: Math.min(b.maxZ, Math.max(b.minZ, p.z)),
  };
}

export function clampDistance(d: number, min: number, max: number): number {
  if (!Number.isFinite(d)) return max;
  return Math.min(max, Math.max(min, d));
}

/**
 * New target after zooming from `oldDistance` to `newDistance` so the ground
 * point `anchor` (under the fingers or cursor) stays put on screen.
 *
 * With a fixed camera orientation, every ground point's offset from the target
 * scales linearly with distance, so this is exact for a perspective camera.
 */
export function zoomAbout(
  target: GroundPoint,
  anchor: GroundPoint,
  oldDistance: number,
  newDistance: number,
): GroundPoint {
  const k = newDistance / oldDistance;
  return { x: anchor.x - (anchor.x - target.x) * k, z: anchor.z - (anchor.z - target.z) * k };
}

export interface InertiaState {
  readonly target: GroundPoint;
  /** World units per second. */
  readonly velocity: GroundPoint;
}

/**
 * Advances a fling by `dt` seconds. Velocity decays exponentially with time
 * constant `tau` and the position uses the exact integral, so the glide is the
 * same length at 30, 60 or 120 fps. Hitting a bound stops that axis.
 */
export function stepInertia(
  state: InertiaState,
  dt: number,
  tau: number,
  stopSpeed: number,
  bounds: Bounds,
): InertiaState {
  const { velocity: v } = state;
  if (v.x === 0 && v.z === 0) return state;
  const decay = Math.exp(-dt / tau);
  const travel = tau * (1 - decay);
  const moved = { x: state.target.x + v.x * travel, z: state.target.z + v.z * travel };
  const target = clampTarget(moved, bounds);
  let vx = target.x === moved.x ? v.x * decay : 0;
  let vz = target.z === moved.z ? v.z * decay : 0;
  if (Math.hypot(vx, vz) < stopSpeed) {
    vx = 0;
    vz = 0;
  }
  return { target, velocity: { x: vx, z: vz } };
}

export interface MotionSample {
  /** Milliseconds, any monotonic clock. */
  readonly t: number;
  readonly p: GroundPoint;
}

/**
 * Release velocity of a pan from recent target positions. Only samples within
 * `windowMs` of the release count, so a finger that stopped before lifting
 * doesn't fling. Speeds below `minSpeed` give zero and above `maxSpeed` are
 * clamped.
 */
export function releaseVelocity(
  samples: readonly MotionSample[],
  releaseT: number,
  windowMs: number,
  minSpeed: number,
  maxSpeed: number,
): GroundPoint {
  const recent = samples.filter((s) => releaseT - s.t <= windowMs);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || last.t - first.t < 1) return ZERO;
  const dt = (last.t - first.t) / 1000;
  const vx = (last.p.x - first.p.x) / dt;
  const vz = (last.p.z - first.p.z) / dt;
  const speed = Math.hypot(vx, vz);
  if (speed < minSpeed) return ZERO;
  const k = speed > maxSpeed ? maxSpeed / speed : 1;
  return { x: vx * k, z: vz * k };
}

/** Distance multiplier for a wheel/trackpad delta (positive = zoom out). */
export function wheelZoomFactor(deltaPx: number, perHundredPx: number): number {
  return Math.pow(perHundredPx, deltaPx / 100);
}

/**
 * Where a glide to another spot on the map is at `progress` (0…1): eased out
 * (fast, then settling), clamped to the map. Used by "Find on map".
 */
export function glideAt(
  from: GroundPoint,
  to: GroundPoint,
  progress: number,
  bounds: Bounds,
): GroundPoint {
  const t = Math.min(Math.max(progress, 0), 1);
  const eased = 1 - (1 - t) ** 3;
  return clampTarget(
    { x: from.x + (to.x - from.x) * eased, z: from.z + (to.z - from.z) * eased },
    bounds,
  );
}
