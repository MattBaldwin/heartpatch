import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CameraRig } from './directions.js';

/*
 * The battle camera for the look prototypes: a fixed rig per direction
 * (pitch, swing, fov) that fits the fight's box into the safe region
 * between the top pills and the bottom sheet, moves the picture up with a
 * vertical lens shift so the horizon stays level, and adds a beat (push-in,
 * shake, a dutch roll) on impact. Pure numbers in; the scene writes them
 * into the stage camera each frame.
 */

export interface SafeRegion {
  /** Fractions of the screen height, from the top: where the fight may be drawn. */
  readonly top: number;
  readonly bottom: number;
}

export interface Beat {
  /** 0–1 of the rig's push-in. */
  readonly push: number;
  /** 0–1 of the rig's shake. */
  readonly shake: number;
  /** Phase for the shake wobble (ms). */
  readonly shakeAge: number;
  /** 0–1 of the rig's dutch roll. */
  readonly roll: number;
  /** Lean the aim towards a world point (null: the fight's middle). */
  readonly focus: { x: number; z: number } | null;
  readonly focusAmount: number;
}

export const NO_BEAT: Beat = { push: 0, shake: 0, shakeAge: 0, roll: 0, focus: null, focusAmount: 0 };

/** Something that must stay on screen: a world point with a radius and a height above it. */
export interface FitPoint {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface Shot {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  fov: number;
  shift: number;
  distance: number;
}

const scratchProjection = new Matrix();

export function computeShot(
  rig: CameraRig,
  aspect: number,
  safe: SafeRegion,
  beat: Beat,
  fit: readonly FitPoint[],
  out: Shot,
): Shot {
  const tan = Math.tan(rig.fov / 2);
  // The aim (the fighters' feet line) lands at `feetY`; their heads must stay
  // under the top pills. The lens shift puts the aim there without tilting the
  // camera, so the horizon stays level and the sky shows behind the fight.
  const feetY = Math.min(rig.feetY, safe.bottom - 0.08);
  const headroom = Math.max(0.15, (feetY - safe.top - 0.03) * 2);
  // Every fit point must fit: sideways within the screen (with a margin) and
  // upwards within the headroom, judged at its own depth along the view.
  const yc = Math.cos(rig.yaw);
  const ys = Math.sin(rig.yaw);
  const cp = Math.cos(rig.pitch);
  let distance = Math.max(rig.fitHeight / (tan * headroom), rig.fitHalfWidth / (tan * aspect * 0.95));
  for (const f of fit) {
    const dx = f.x - rig.aim.x;
    const dz = f.z - rig.aim.z;
    // Along the view (ground-projected) and across it.
    const along = (dx * ys + dz * yc) * cp;
    const across = Math.abs(dx * yc - dz * ys) + f.r;
    distance = Math.max(distance, across / (tan * Math.max(0.3, aspect) * 0.94) + along);
    distance = Math.max(distance, f.h / (tan * headroom) + along);
  }
  distance *= 1 - rig.hitPush * beat.push;
  const shift = 1 - 2 * feetY;

  const ax = rig.aim.x + (beat.focus ? (beat.focus.x - rig.aim.x) * beat.focusAmount : 0);
  const az = rig.aim.z + (beat.focus ? (beat.focus.z - rig.aim.z) * beat.focusAmount : 0);
  const ay = rig.aim.y;

  const t = beat.shakeAge / 1000;
  const fade = beat.shake > 0 ? Math.exp(-9 * t) : 0;
  const w = Math.PI * 2 * 21 * t;
  const sx = rig.shake * beat.shake * fade * Math.sin(w);
  const sy = rig.shake * beat.shake * fade * 0.6 * Math.sin(w * 1.37 + 1.1);

  // Looking along +z, swung by yaw and tilted down by pitch.
  const back = Math.cos(rig.pitch) * distance;
  const up = Math.sin(rig.pitch) * distance;
  out.position.set(ax - Math.sin(rig.yaw) * back + sx, ay + up + sy, az - Math.cos(rig.yaw) * back);
  out.target.set(ax + sx, ay + sy, az);
  const roll = rig.roll * beat.roll * fade;
  out.up.set(Math.sin(roll), Math.cos(roll), 0);
  out.fov = rig.fov;
  out.shift = shift;
  out.distance = distance;
  return out;
}

/** Writes a shot into the stage camera (call from onBeforeRender). */
export function applyShot(camera: TargetCamera, shot: Shot, minZ: number, maxZ: number): void {
  camera.fov = shot.fov;
  camera.minZ = minZ;
  camera.maxZ = maxZ;
  camera.upVector.copyFrom(shot.up);
  camera.position.copyFrom(shot.position);
  camera.setTarget(shot.target);
  camera.unfreezeProjectionMatrix();
  scratchProjection.copyFrom(camera.getProjectionMatrix(true));
  scratchProjection.addAtIndex(9, shot.shift);
  camera.freezeProjectionMatrix(scratchProjection);
}
