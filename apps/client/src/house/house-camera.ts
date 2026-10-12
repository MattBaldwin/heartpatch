import type { CinematicShot } from '@heartpatch/shared';
import { cameraBasis, type Vec3 } from '../engine/camera/camera-math.js';
import { cameraAt } from '../cinematics/timeline.js';
import { HOUSE_CAMERA, HOUSE_GLIDE } from './house-config.js';
import type { HouseBounds } from './house-layout.js';

/*
 * The house camera (#381 plan §1c), pure: no Babylon, no DOM, and nothing
 * about what's in the rooms, only the house's box, so it scales by data as
 * the house grows. The dollhouse pose fits the whole house between the HUD's
 * top bar and its bottom controls; a pinch moves in a little and a pinch out
 * past the dollhouse goes back home. The roof-off entry glide is a shot on
 * the cinematic `Timeline` (`cameraAt`), so reduced motion cuts to the end.
 */

const DEG = Math.PI / 180;

/** Where the camera is and what it looks at. */
export interface HousePose {
  readonly eye: Vec3;
  readonly target: Vec3;
  /** Vertical field of view, radians. */
  readonly fov: number;
  /** Tilt down from the horizon, radians (negative looks up). */
  readonly pitch: number;
}

/** The canvas in CSS px, and the bands the HUD covers at its top and bottom. */
export interface HouseViewport {
  readonly width: number;
  readonly height: number;
  /** Covered at the top (Back and the House pill). */
  readonly top: number;
  /** Covered at the bottom (the peek bar and the bottom-right button). */
  readonly bottom: number;
}

/** A portrait phone (steeper and wider-angle than a tablet or landscape). */
export const isPhone = (vp: Pick<HouseViewport, 'width' | 'height'>): boolean =>
  vp.width / Math.max(1, vp.height) < HOUSE_CAMERA.phoneAspect;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The box's eight corners. */
function corners(b: HouseBounds): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.minX, b.maxX])
    for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) out.push({ x, y, z });
  return out;
}

/** A point's normalised device position (x right, y up, -1..1) from a pose. */
export function project(
  pose: HousePose,
  aspect: number,
  p: Vec3,
): { x: number; y: number; depth: number } {
  const f = sub(pose.target, pose.eye);
  const len = Math.hypot(f.x, f.y, f.z) || 1;
  const fwd = scale(f, 1 / len);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y)));
  const yaw = Math.atan2(fwd.x, fwd.z);
  const { right, up } = cameraBasis(pitch, yaw);
  const d = sub(p, pose.eye);
  const depth = dot(d, fwd);
  const t = Math.tan(pose.fov / 2);
  return { x: dot(d, right) / depth / (t * aspect), y: dot(d, up) / depth / t, depth };
}

/** The safe area in normalised device coordinates: inside the HUD, less the margin. */
export function safeArea(vp: HouseViewport): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const m = HOUSE_CAMERA.margin;
  const w = Math.max(1, vp.width);
  const h = Math.max(1, vp.height);
  return {
    left: -1 + (2 * m) / w,
    right: 1 - (2 * m) / w,
    top: 1 - (2 * (vp.top + m)) / h,
    bottom: -1 + (2 * (vp.bottom + m)) / h,
  };
}

/**
 * The dollhouse pose: looking down at the open-fronted house (yaw 0, from
 * the front), the whole box as big as fits inside the safe area and
 * centred in it. Steeper on a portrait phone, so a tall frame fills with
 * house rather than lawn.
 */
export function fitHouse(bounds: HouseBounds, vp: HouseViewport): HousePose {
  const phone = isPhone(vp);
  const pitch = (phone ? HOUSE_CAMERA.pitch.phone : HOUSE_CAMERA.pitch.wide) * DEG;
  const fov = (phone ? HOUSE_CAMERA.fov.phone : HOUSE_CAMERA.fov.wide) * DEG;
  const aspect = vp.width / Math.max(1, vp.height);
  const { forward, right, up } = cameraBasis(pitch, 0);
  const safe = safeArea(vp);
  const halfW = (safe.right - safe.left) / 2;
  const halfH = Math.max(0.05, (safe.top - safe.bottom) / 2);
  const cx = (safe.right + safe.left) / 2;
  const cy = (safe.top + safe.bottom) / 2;
  const box = corners(bounds);
  let target: Vec3 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) * 0.3,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);
  let distance = span * 2;
  const t = Math.tan(fov / 2);
  // Fixed-point: scale the distance so the box fills the safe area, then
  // slide the target so it sits in the middle of it.
  for (let i = 0; i < 80; i += 1) {
    const pose = { eye: sub(target, scale(forward, distance)), target, fov, pitch };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of box) {
      const n = project(pose, aspect, p);
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const k = Math.max((maxX - minX) / 2 / halfW, (maxY - minY) / 2 / halfH);
    distance *= 1 + (k - 1) * 0.7;
    target = add(target, scale(right, ((maxX + minX) / 2 - cx) * distance * t * aspect * 0.6));
    target = add(target, scale(up, ((maxY + minY) / 2 - cy) * distance * t * 0.6));
  }
  return { eye: sub(target, scale(forward, distance)), target, fov, pitch };
}

/**
 * The dollhouse pose with a pinch's zoom: 0 is the fitted dollhouse, 1 is
 * as close as the dollhouse goes (`closest`). Below 0 (pinching out) it
 * holds; the screen goes home past `exitOvershoot`.
 */
export function zoomPose(pose: HousePose, zoom: number): HousePose {
  const z = clampZoom(zoom);
  const k = 1 - (1 - HOUSE_CAMERA.closest) * z;
  return { ...pose, eye: add(pose.target, scale(sub(pose.eye, pose.target), k)) };
}

/** Zoom kept to the dollhouse's range. */
export const clampZoom = (zoom: number): number => Math.min(1, Math.max(0, zoom));

/** A pinch's new zoom from the finger spread now and at its start (CSS px). */
export function pinchZoom(startZoom: number, startSpread: number, spread: number): number {
  if (startSpread <= 0 || spread <= 0) return startZoom;
  return startZoom + Math.log(spread / startSpread) / HOUSE_CAMERA.pinchPerZoom;
}

/** A pinch released this far out of the dollhouse goes back home. */
export const pinchedOut = (zoom: number): boolean => zoom <= -HOUSE_CAMERA.exitOvershoot;

const vec = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/**
 * The roof-off entry glide as one cinematic shot: from outside, lower and
 * further back with the roof on, rising to the dollhouse pose while the
 * roof lifts away (`roofAt`).
 */
export function entryGlide(pose: HousePose): CinematicShot {
  const back = sub(pose.eye, pose.target);
  const distance = Math.hypot(back.x, back.y, back.z) * HOUSE_GLIDE.startDistance;
  const { forward } = cameraBasis(HOUSE_GLIDE.startPitch * DEG, 0);
  const start = sub(pose.target, scale(forward, distance));
  const s = HOUSE_GLIDE.seconds;
  return {
    id: 'house-entry',
    title: 'Into the house',
    duration: s,
    transition: 'cut',
    music: 'none',
    camera: [
      { at: 0, position: vec(start), target: vec(pose.target), fov: pose.fov },
      { at: s, position: vec(pose.eye), target: vec(pose.target), fov: pose.fov },
    ],
    mood: [{ at: 0, drain: 0, night: 0, glow: 1 }],
    captions: [],
    cues: [],
    actors: [],
    dissolves: [],
    claims: [],
    shakes: [],
  };
}

/** The camera `local` seconds into the entry glide (reduced motion: the end at once). */
export function glidePose(shot: CinematicShot, local: number, reducedMotion: boolean): HousePose {
  const at = cameraAt(shot, local, reducedMotion);
  const eye = { x: at.position[0], y: at.position[1], z: at.position[2] };
  const target = { x: at.target[0], y: at.target[1], z: at.target[2] };
  const f = sub(target, eye);
  const pitch = Math.asin(-f.y / (Math.hypot(f.x, f.y, f.z) || 1));
  return { eye, target, fov: at.fov, pitch };
}

/**
 * How far the roof has lifted (0 on, 1 gone) `local` seconds into the
 * glide: it rises after a beat and is gone before the camera settles.
 */
export function roofAt(local: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const t = local / HOUSE_GLIDE.seconds;
  const s = (t - HOUSE_GLIDE.roofFrom) / (HOUSE_GLIDE.roofTo - HOUSE_GLIDE.roofFrom);
  const c = Math.min(1, Math.max(0, s));
  return c * c * (3 - 2 * c);
}
