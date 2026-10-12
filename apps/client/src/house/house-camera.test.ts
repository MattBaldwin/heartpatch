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
  zoomPose,
  type HouseViewport,
} from './house-camera.js';
import { HOUSE_CAMERA, HOUSE_GLIDE } from './house-config.js';
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

describe('dollhouse zoom', () => {
  const pose = fitHouse(snug, iphone);
  const dist = (p: typeof pose) =>
    Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z);

  it('moves in along the same line, no closer than `closest`, and never out past the dollhouse', () => {
    expect(dist(zoomPose(pose, 0))).toBeCloseTo(dist(pose));
    expect(dist(zoomPose(pose, 1))).toBeCloseTo(dist(pose) * HOUSE_CAMERA.closest);
    expect(dist(zoomPose(pose, 5))).toBeCloseTo(dist(pose) * HOUSE_CAMERA.closest);
    expect(dist(zoomPose(pose, -1))).toBeCloseTo(dist(pose));
    expect(zoomPose(pose, 0.5).pitch).toBe(pose.pitch);
  });

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
