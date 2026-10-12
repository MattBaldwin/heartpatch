import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  entryGlide,
  fitHouse,
  glidePose,
  isPhone,
  pinchedOut,
  pinchZoom,
  project,
  roofAt,
  safeArea,
  blend,
  frontAlpha,
  kidPose,
  wallFade,
  walkedIn,
  walkZoom,
  type HouseViewport,
} from './house-camera.js';
import { HOUSE_CAMERA, HOUSE_GLIDE, HOUSE_KID } from './house-config.js';
import type { HouseBounds } from './house-layout.js';

const snug: HouseBounds = { minX: -0.24, maxX: 5.04, minY: 0, maxY: 3, minZ: -0.35, maxZ: 5.04 };
const grown: HouseBounds = { minX: -0.24, maxX: 9.84, minY: 0, maxY: 6, minZ: -0.35, maxZ: 11.44 };
const iphone: HouseViewport = { width: 390, height: 844, top: 80, bottom: 90 };
const ipad: HouseViewport = { width: 820, height: 1180, top: 70, bottom: 90 };
const deg = (r: number) => (r * 180) / Math.PI;

function corners(b: HouseBounds) {
  const out = [];
  for (const x of [b.minX, b.maxX])
    for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) out.push({ x, y, z });
  return out;
}

describe('fitHouse', () => {
  for (const [name, vp] of [
    ['iPhone', iphone],
    ['iPad', ipad],
  ] as const) {
    for (const [house, b] of [
      ['one room', snug],
      ['the grown house', grown],
    ] as const) {
      it(`fits ${house} inside the HUD on ${name}, filling one side`, () => {
        const pose = fitHouse(b, vp);
        const safe = safeArea(vp);
        const aspect = vp.width / vp.height;
        const pts = corners(b).map((p) => project(pose, aspect, p));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(safe.left - 0.01);
        expect(Math.max(...xs)).toBeLessThanOrEqual(safe.right + 0.01);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(safe.bottom - 0.01);
        expect(Math.max(...ys)).toBeLessThanOrEqual(safe.top + 0.01);
        // As big as fits: it touches the safe area on its left and right, or top and bottom.
        const wide = (Math.max(...xs) - Math.min(...xs)) / (safe.right - safe.left);
        const tall = (Math.max(...ys) - Math.min(...ys)) / (safe.top - safe.bottom);
        expect(Math.max(wide, tall)).toBeGreaterThan(0.97);
        // Centred in it.
        expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(
          (safe.top + safe.bottom) / 2,
          1,
        );
      });
    }
  }

  it('looks down steeper on a portrait phone than on an iPad, inside the planned ranges', () => {
    const phone = deg(fitHouse(snug, iphone).pitch);
    const tablet = deg(fitHouse(snug, ipad).pitch);
    expect(isPhone(iphone)).toBe(true);
    expect(isPhone(ipad)).toBe(false);
    expect(phone).toBeGreaterThanOrEqual(52);
    expect(phone).toBeLessThanOrEqual(58);
    expect(tablet).toBeGreaterThanOrEqual(40);
    expect(tablet).toBeLessThanOrEqual(52);
    expect(phone).toBeGreaterThan(tablet);
  });

  it('only takes the house’s box: a bigger house stands further back', () => {
    const near = fitHouse(snug, iphone);
    const far = fitHouse(grown, iphone);
    const d = (p: typeof near) =>
      Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z);
    expect(d(far)).toBeGreaterThan(d(near));
  });
});

describe('walking in: kid height', () => {
  const room: HouseBounds = { minX: 0, maxX: 4.8, minY: 0, maxY: 3, minZ: 0, maxZ: 4.8 };
  const doll = fitHouse(snug, iphone);
  const kid = kidPose(room, iphone);

  it('stands at a small squishy’s eye level, tilted up 3–4°, the frame no wider than the back wall', () => {
    expect(kid.eye.y).toBeCloseTo(HOUSE_KID.eyeHeight);
    expect(-deg(kid.pitch)).toBeGreaterThanOrEqual(3);
    expect(-deg(kid.pitch)).toBeLessThanOrEqual(4);
    expect(kid.eye.z).toBeLessThan(room.minZ); // back from the open front
    const aspect = iphone.width / iphone.height;
    // Never wider than the back wall: nothing past the side walls in the frame.
    // (the wall's own thickness, `sideRoom`, may show at the edges).
    for (const x of [room.minX - HOUSE_KID.sideRoom, room.maxX + HOUSE_KID.sideRoom]) {
      const p = project(kid, aspect, { x, y: kid.eye.y, z: room.maxZ });
      expect(Math.abs(p.x)).toBeGreaterThanOrEqual(0.99);
    }
    // A tall phone caps its vertical view (less floor in the frame).
    expect(deg(kid.fov)).toBeLessThanOrEqual(HOUSE_KID.maxVerticalFov + 1e-9);
    // Only the room's box: a room upstairs is the same pose, a storey up.
    const up = kidPose({ ...room, minY: 3, maxY: 6 }, iphone);
    expect(up.eye.y - kid.eye.y).toBeCloseTo(3);
  });

  it('blends from the dollhouse at 0 to kid height at 1', () => {
    const at0 = blend(doll, kid, 0);
    const at1 = blend(doll, kid, 1);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(at0.eye[k]).toBeCloseTo(doll.eye[k]);
      expect(at1.eye[k]).toBeCloseTo(kid.eye[k]);
    }
    expect(deg(at1.pitch)).toBeLessThan(15);
  });

  it('keeps looking down through most of the zoom, then eases to kid height over the last part', () => {
    const early = blend(doll, kid, HOUSE_KID.pitchFrom * 0.9);
    expect(early.pitch).toBeCloseTo(doll.pitch);
    const late = blend(doll, kid, 0.85);
    expect(late.pitch).toBeLessThan(doll.pitch);
    expect(late.pitch).toBeGreaterThan(kid.pitch);
    let last = Infinity;
    for (let z = 0; z <= 1.0001; z += 0.1) {
      const p = blend(doll, kid, z);
      const d = Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z);
      expect(d).toBeLessThanOrEqual(last + 1e-9); // always moving in
      last = d;
    }
  });

  it('fades only the walls between the camera and the room', () => {
    const focus = { x: 2.4, y: 0.8, z: 2.4 };
    const front = { axis: 'x' as const, at: 0, from: 0, to: 4.8, y0: 0, height: 3 };
    const back = { axis: 'x' as const, at: 4.8, from: 0, to: 4.8, y0: 0, height: 3 };
    const left = { axis: 'z' as const, at: 0, from: 0, to: 4.8, y0: 0, height: 3 };
    expect(wallFade(kid.eye, focus, front)).toBe(HOUSE_KID.fadedAlpha);
    expect(wallFade(kid.eye, focus, back)).toBe(1);
    expect(wallFade(kid.eye, focus, left)).toBe(1);
    // From high above the dollhouse the line of sight passes over the front wall.
    expect(wallFade(doll.eye, focus, front)).toBe(1);
    // An upstairs wall isn't in the way of a ground-floor look.
    expect(wallFade(kid.eye, focus, { ...front, y0: 3 })).toBe(1);
  });

  it('takes the wall in the way away at rest at kid height, veiling it only on the way', () => {
    const focus = { x: 2.4, y: 0.8, z: 2.4 };
    const front = { axis: 'x' as const, at: 0, from: 0, to: 4.8, y0: 0, height: 3 };
    const fade = wallFade(kid.eye, focus, front);
    expect(fade).toBe(HOUSE_KID.fadedAlpha);
    expect(frontAlpha(fade, 1)).toBe(0); // at rest: gone
    expect(frontAlpha(fade, 0)).toBe(0); // the dollhouse: none
    const passing = frontAlpha(fade, 0.75);
    expect(passing).toBeGreaterThan(0);
    expect(passing).toBeLessThanOrEqual(HOUSE_KID.fadedAlpha);
    expect(frontAlpha(1, 1)).toBe(1); // a wall not in the way stays solid
  });

  it('walks in and out over a beat, or cuts with reduced motion', () => {
    expect(walkZoom(0, 1, 0, false)).toBe(0);
    expect(walkZoom(0, 1, HOUSE_KID.walkSeconds, false)).toBe(1);
    const mid = walkZoom(0, 1, HOUSE_KID.walkSeconds / 2, false);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(walkZoom(1, 0, 0, true)).toBe(0);
    expect(walkedIn(0.2)).toBe(false);
    expect(walkedIn(1)).toBe(true);
  });
});

describe('pinch', () => {
  it('pinches by the finger spread, and a pinch out past the dollhouse goes home', () => {
    expect(pinchZoom(0, 100, 100)).toBe(0);
    expect(pinchZoom(0, 100, 200)).toBeGreaterThan(0);
    expect(pinchZoom(0.5, 200, 100)).toBeLessThan(0.5);
    expect(pinchZoom(0.3, 0, 100)).toBe(0.3);
    expect(pinchedOut(-0.05)).toBe(false);
    expect(pinchedOut(-HOUSE_CAMERA.exitOvershoot)).toBe(true);
    expect(clampZoom(-2)).toBe(0);
    expect(clampZoom(3)).toBe(1);
  });
});

describe('the roof-off entry glide', () => {
  const pose = fitHouse(snug, iphone);
  const shot = entryGlide(pose);

  it('is a cinematic shot that starts lower and further out and ends at the dollhouse pose', () => {
    expect(shot.duration).toBe(HOUSE_GLIDE.seconds);
    const start = glidePose(shot, 0, false);
    const end = glidePose(shot, shot.duration, false);
    expect(deg(start.pitch)).toBeCloseTo(HOUSE_GLIDE.startPitch, 0);
    expect(end.eye.x).toBeCloseTo(pose.eye.x);
    expect(end.eye.y).toBeCloseTo(pose.eye.y);
    expect(end.eye.z).toBeCloseTo(pose.eye.z);
    expect(deg(end.pitch)).toBeCloseTo(deg(pose.pitch), 1);
  });

  it('cuts straight to the dollhouse with reduced motion', () => {
    const cut = glidePose(shot, 0, true);
    expect(cut.eye.y).toBeCloseTo(pose.eye.y);
    expect(roofAt(0, true)).toBe(1);
  });

  it('lifts the roof after a beat and has it gone before the camera settles', () => {
    expect(roofAt(0, false)).toBe(0);
    expect(roofAt(HOUSE_GLIDE.seconds * HOUSE_GLIDE.roofTo, false)).toBe(1);
    const mid = roofAt(HOUSE_GLIDE.seconds * 0.4, false);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
