import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  entryGlide,
  fitBox,
  fitHouse,
  framedFocus,
  glidePose,
  panPerPixel,
  panPose,
  panRange,
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
        // Across, centred; up and down, the house and its yard centred
        // between the top bar and the sheet, unless the house meets an edge.
        expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(
          (safe.left + safe.right) / 2,
          1,
        );
        const yard = [b.minX, b.maxX].map(
          (x) => project(pose, aspect, { x, y: -0.3, z: b.minZ - HOUSE_CAMERA.yard }).y,
        );
        const sheet = -1 + (2 * (HOUSE_CAMERA.sheet + HOUSE_CAMERA.margin)) / vp.height;
        const group = (Math.max(...ys) + Math.min(...ys, ...yard)) / 2;
        const edge = Math.min(
          Math.abs(Math.max(...ys) - safe.top),
          Math.abs(Math.min(...ys) - safe.bottom),
        );
        expect(Math.min(Math.abs(group - (safe.top + sheet) / 2), edge)).toBeLessThan(0.02);
      });
    }
  }

  it('lifts a wide house up under the top bar on a tall phone, its yard filling the band over the sheet (B4)', () => {
    const wide: HouseBounds = {
      minX: -0.24,
      maxX: 9.84,
      minY: 0,
      maxY: 3,
      minZ: -0.35,
      maxZ: 5.04,
    };
    const vp: HouseViewport = { ...iphone, bottom: 150, sheet: 79 };
    const pose = fitHouse(wide, vp);
    const safe = safeArea(vp);
    const aspect = vp.width / vp.height;
    const ys = corners(wide).map((p) => project(pose, aspect, p).y);
    // Width-bound: the house can't fill the height, so it rides up rather than sitting mid-lawn.
    const above = safe.top - Math.max(...ys);
    const below = Math.min(...ys) - safe.bottom;
    expect(above).toBeLessThan(below);
    expect(above).toBeGreaterThanOrEqual(-0.01);
    // The yard's fence stays in frame, above the sheet.
    const sheet = -1 + (2 * (79 + HOUSE_CAMERA.margin)) / vp.height;
    const fence = project(pose, aspect, { x: 4.8, y: -0.3, z: wide.minZ - HOUSE_CAMERA.yard });
    expect(fence.y).toBeGreaterThan(sheet);
    // A taller sheet (measured from the DOM) moves the house and yard up with it.
    const raised = fitHouse(wide, { ...vp, sheet: 200 });
    const top = (p: typeof pose) => Math.max(...corners(wide).map((c) => project(p, aspect, c).y));
    expect(top(raised)).toBeGreaterThan(top(pose));
    expect(top(raised)).toBeLessThanOrEqual(safe.top + 0.01);
  });

  describe('a tall phone fits the Keeper’s room and slides to the rest (B4)', () => {
    // Level 2: the Snug and the Playroom side by side.
    const two: HouseBounds = { minX: -0.24, maxX: 9.84, minY: 0, maxY: 3, minZ: -0.35, maxZ: 5.04 };
    const snugRoom = { minX: 0, maxX: 4.8 };
    const vp: HouseViewport = { ...iphone, bottom: 150, sheet: 79 };
    const aspect = vp.width / vp.height;
    const span = (pose: ReturnType<typeof fitHouse>, b: HouseBounds) => {
      const ys = corners(b).map((p) => project(pose, aspect, p).y);
      return Math.max(...ys) - Math.min(...ys);
    };

    it('shows the Snug much bigger than the whole house fitted across, with an edge of the Playroom', () => {
      const whole = fitHouse(two, vp);
      const focused = fitHouse(two, vp, undefined, snugRoom);
      // The Snug's on-screen height grows by half again or more.
      const snugBox = { ...two, maxX: 4.8 };
      expect(span(focused, snugBox)).toBeGreaterThan(span(whole, snugBox) * 1.5);
      // The Snug whole on screen, and the Playroom running off the right edge.
      const safe = safeArea(vp);
      const xs = corners(snugBox).map((p) => project(focused, aspect, p).x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(safe.left - 0.01);
      expect(Math.max(...xs)).toBeLessThan(safe.right);
      const far = project(focused, aspect, { x: two.maxX, y: 0, z: two.minZ });
      expect(far.x).toBeGreaterThan(1);
      const peek = project(focused, aspect, {
        x: 4.8 + HOUSE_CAMERA.peek * 0.8,
        y: 0,
        z: two.minZ,
      });
      expect(peek.x).toBeLessThan(1);
    });

    it('nudges the peek so the frame’s edge falls between residents, never through one (round 2)', () => {
      const r = 0.6;
      // A resident right where the usual frame's right edge falls.
      const usual = fitHouse(two, vp, undefined, snugRoom);
      const t = Math.tan(usual.fov / 2) * aspect;
      let x = 5;
      for (; x < 9; x += 0.05) {
        const c = project(usual, aspect, { x, y: 0.6, z: 2.4 });
        if (c.x >= 1) break;
      }
      const spot = { x, y: 0.6, z: 2.4, r };
      const focus = framedFocus(two, vp, snugRoom, [spot])!;
      expect(focus.peek).not.toBe(HOUSE_CAMERA.peek);
      const pose = fitHouse(two, vp, undefined, focus);
      const c = project(pose, aspect, spot);
      const w = r / c.depth / t;
      expect(c.x + w <= 1 || c.x - w >= 1).toBe(true);
      // Nobody near an edge: the usual peek.
      expect(framedFocus(two, vp, snugRoom, [{ x: 2.4, y: 0.6, z: 2.4, r }])!.peek).toBe(
        HOUSE_CAMERA.peek,
      );
      // An iPad keeps the room as it is (the whole house shows).
      expect(framedFocus(two, ipad, snugRoom, [spot])).toEqual(snugRoom);
    });

    it('slides as far as either end of the house, and no further', () => {
      const range = panRange(two, vp, snugRoom);
      expect(range.min).toBeCloseTo(0);
      expect(range.max).toBeCloseTo(two.maxX - (4.8 + HOUSE_CAMERA.peek));
      // Slid all the way: the Playroom's far end is where the Snug's near end was.
      const fitted = fitHouse(two, vp, undefined, snugRoom);
      const slid = panPose(fitted, range.max);
      const end = project(slid, aspect, { x: two.maxX, y: 0, z: two.minZ }).x;
      const start = project(fitted, aspect, { x: two.minX, y: 0, z: two.minZ }).x;
      expect(end).toBeCloseTo(-start, 1);
      // A drag of the screen's width moves the house about a screen's worth.
      const metres = panPerPixel(fitted, vp) * vp.width;
      const moved = project(panPose(fitted, metres), aspect, fitted.target).x;
      expect(moved).toBeCloseTo(-2, 0);
    });

    it('keeps the whole house on an iPad, and on a phone when the house is no wider than its room', () => {
      expect(fitBox(two, ipad, snugRoom)).toEqual(two);
      expect(panRange(two, ipad, snugRoom)).toEqual({ min: 0, max: 0 });
      expect(fitBox(snug, vp, { minX: 0, maxX: 4.8 })).toEqual(snug);
      expect(fitBox(two, vp, null)).toEqual(two);
    });

    it('keeps the tall top level inside the safe area top to bottom while it comes in closer', () => {
      const whole = fitHouse(grown, vp);
      const focused = fitHouse(grown, vp, undefined, snugRoom);
      const safe = safeArea(vp);
      expect(span(focused, grown)).toBeGreaterThan(span(whole, grown));
      const ys = corners(grown).map((p) => project(focused, aspect, p).y);
      expect(Math.max(...ys)).toBeLessThanOrEqual(safe.top + 0.01);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(safe.bottom - 0.01);
    });
  });

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
