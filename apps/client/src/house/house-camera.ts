import type { CinematicShot } from '@heartpatch/shared';
import { cameraBasis, type Vec3 } from '../engine/camera/camera-math.js';
import { cameraAt } from '../cinematics/timeline.js';
import { HOUSE_CAMERA, HOUSE_GLIDE, HOUSE_KID } from './house-config.js';
import type { HouseBounds } from './house-layout.js';

/*
 * The house camera (#381 plan §1c), pure: no Babylon, no DOM, and nothing
 * about what's in the rooms, only the house's box, so it scales by data as
 * the house grows. The dollhouse pose fits the whole house between the HUD's
 * top bar and its bottom controls; a pinch (or Walk in) sinks to kid height
 * with the walls in the way fading, and a pinch out past the dollhouse goes
 * back home. The roof-off entry glide is a shot on
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
 * Kid height in a room (owner decision 15: pinch in and you sink down to
 * kid height with the walls in the way fading): standing back from the
 * room's front at a small squishy's eye level, tilted up a little, far
 * enough back that the room's back wall fits across the frame. Tall frames
 * keep their vertical view angle capped (less floor, owner check #2) and so
 * stand further back. Only the room's box is taken, never what's in it.
 */
export function kidPose(room: HouseBounds, vp: HouseViewport): HousePose {
  const aspect = vp.width / Math.max(1, vp.height);
  const maxV = HOUSE_KID.maxVerticalFov * DEG;
  let hfov = HOUSE_KID.horizontalFov * DEG;
  let fov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
  if (fov > maxV) {
    fov = maxV;
    hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  }
  const pitch = -HOUSE_KID.tiltUp * DEG;
  const width = room.maxX - room.minX;
  // Far enough back for the back wall to fit across, and never so close the
  // residents fill the frame (a wide iPad frame would stand right on them).
  const halfWall = width / 2 + HOUSE_KID.sideRoom;
  const back = Math.max(
    halfWall / Math.tan(hfov / 2),
    room.maxZ - room.minZ + HOUSE_KID.minStandBack,
  );
  // Then narrow the view to the back wall, so nothing past the side walls shows.
  hfov = 2 * Math.atan(halfWall / back);
  fov = Math.min(maxV, 2 * Math.atan(Math.tan(hfov / 2) / aspect));
  const eye: Vec3 = {
    x: (room.minX + room.maxX) / 2,
    y: room.minY + HOUSE_KID.eyeHeight,
    z: room.maxZ - back,
  };
  const { forward } = cameraBasis(pitch, 0);
  return { eye, target: add(eye, scale(forward, HOUSE_KID.lookAhead)), fov, pitch };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * The camera between the dollhouse (zoom 0) and kid height (zoom 1): the
 * focus slides into the room and the distance shrinks as you pinch, while
 * the pitch holds the dollhouse's look down until the last part of the
 * zoom (`pitchFrom`), then eases down to kid height. At 1 it is exactly the
 * kid pose.
 */
export function blend(doll: HousePose, kid: HousePose, zoom: number): HousePose {
  const z = clampZoom(zoom);
  const ez = smooth(z);
  const target: Vec3 = {
    x: doll.target.x + (kid.target.x - doll.target.x) * ez,
    y: doll.target.y + (kid.target.y - doll.target.y) * ez,
    z: doll.target.z + (kid.target.z - doll.target.z) * ez,
  };
  const dd = Math.hypot(
    doll.eye.x - doll.target.x,
    doll.eye.y - doll.target.y,
    doll.eye.z - doll.target.z,
  );
  const dk = Math.hypot(
    kid.eye.x - kid.target.x,
    kid.eye.y - kid.target.y,
    kid.eye.z - kid.target.z,
  );
  const distance = Math.exp(Math.log(dd) + (Math.log(dk) - Math.log(dd)) * ez);
  const late = smooth((z - HOUSE_KID.pitchFrom) / (1 - HOUSE_KID.pitchFrom));
  const pitch = doll.pitch + (kid.pitch - doll.pitch) * late;
  const fov = doll.fov + (kid.fov - doll.fov) * ez;
  const { forward } = cameraBasis(pitch, 0);
  return { eye: sub(target, scale(forward, distance)), target, fov, pitch };
}

/** A wall as `wallFade` sees it: a vertical rectangle on a grid line. */
export interface FadeWall {
  readonly axis: 'x' | 'z';
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly y0: number;
  readonly height: number;
}

/**
 * How see-through a wall is from `eye` looking at `focus`: faded (about
 * 0.15, `HOUSE_KID.fadedAlpha`) when it stands between them, so the camera
 * never looks through a solid wall, else 1. The scene adds a soft foot (it
 * fades to nothing at the floor, so no hard line crosses the room).
 */
export function wallFade(eye: Vec3, focus: Vec3, wall: FadeWall): number {
  const a = wall.axis === 'x' ? eye.z : eye.x;
  const b = wall.axis === 'x' ? focus.z : focus.x;
  if ((a - wall.at) * (b - wall.at) > 0 || a === b) return 1;
  const t = (wall.at - a) / (b - a);
  const along = wall.axis === 'x' ? eye.x + (focus.x - eye.x) * t : eye.z + (focus.z - eye.z) * t;
  const y = eye.y + (focus.y - eye.y) * t;
  const margin = HOUSE_KID.fadeMargin;
  const inside =
    along >= wall.from - margin &&
    along <= wall.to + margin &&
    y >= wall.y0 - margin &&
    y <= wall.y0 + wall.height + margin;
  return inside ? HOUSE_KID.fadedAlpha : 1;
}

/**
 * Walk in / Step out: zoom moving toward `goal` over `HOUSE_KID.walkSeconds`
 * from where it was at `start` (seconds since), eased; reduced motion cuts.
 */
export function walkZoom(
  from: number,
  goal: number,
  seconds: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return goal;
  const t = smooth(seconds / HOUSE_KID.walkSeconds);
  return from + (goal - from) * t;
}

/** The zoom past which the screen's button says "Step out" rather than "Walk in". */
export const walkedIn = (zoom: number): boolean => zoom >= 0.5;

/** Zoom kept between the dollhouse (0) and kid height (1). */
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
