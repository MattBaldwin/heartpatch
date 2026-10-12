import { describe, expect, it } from 'vitest';
import { fitHouse, project, type HouseViewport } from './house-camera.js';
import { framedRoomId, framesAboveSheet, sheetBands } from './house-frame.js';
import type { HouseBounds } from './house-layout.js';

const snug: HouseBounds = { minX: -0.24, maxX: 5.04, minY: 0, maxY: 3, minZ: -0.35, maxZ: 5.04 };
const folded = { bottom: 150, sheet: 80 };

/** The lowest the room's floor reaches on screen (CSS px from the top). */
function floorBottom(b: HouseBounds, vp: HouseViewport): number {
  const pose = fitHouse(b, vp);
  const aspect = vp.width / vp.height;
  let low = -Infinity;
  for (const x of [b.minX, b.maxX])
    for (const z of [b.minZ, b.maxZ]) {
      const p = project(pose, aspect, { x, y: b.minY, z });
      low = Math.max(low, ((1 - p.y) / 2) * vp.height);
    }
  return low;
}

describe('framing the house above an open residents page (C2b)', () => {
  it('only the picker and the move-out confirm frame above themselves', () => {
    expect(framesAboveSheet('picker')).toBe(true);
    expect(framesAboveSheet('move-out')).toBe(true);
    for (const s of ['peek', 'open', 'grow', 'confirm']) expect(framesAboveSheet(s)).toBe(false);
  });

  it('frames the room the page is about, and nothing special elsewhere', () => {
    expect(framedRoomId('picker', 'playroom', 'snug')).toBe('playroom');
    expect(framedRoomId('move-out', 'playroom', 'snug')).toBe('snug');
    for (const s of ['peek', 'open', 'grow', 'confirm'])
      expect(framedRoomId(s, 'playroom', 'snug')).toBeNull();
  });

  it('fits with the open sheet’s height while one is open, else the folded bands', () => {
    expect(sheetBands(folded, null)).toEqual(folded);
    expect(sheetBands(folded, 0)).toEqual(folded);
    expect(sheetBands(folded, 460)).toEqual({ bottom: 460, sheet: 460 });
    // Never less than the folded bands.
    expect(sheetBands(folded, 100)).toEqual({ bottom: 150, sheet: 100 });
  });

  for (const [name, vp, open] of [
    ['iPhone', { width: 390, height: 844, top: 80 }, 470],
    ['iPhone SE', { width: 375, height: 667, top: 80 }, 400],
    ['iPad', { width: 820, height: 1180, top: 70 }, 640],
  ] as const) {
    it(`${name}: the room sits clear above the open sheet, and back down when it closes`, () => {
      const closed = floorBottom(snug, { ...vp, ...folded });
      const raised = floorBottom(snug, { ...vp, ...sheetBands(folded, open) });
      // With the folded fit the open sheet would cover the room's front.
      expect(closed).toBeGreaterThan(vp.height - open);
      // Fitted to the open sheet, the whole floor is above it.
      expect(raised).toBeLessThanOrEqual(vp.height - open);
      // Closing fits back to the folded bands (the same pose as before).
      expect(floorBottom(snug, { ...vp, ...sheetBands(folded, null) })).toBeCloseTo(closed, 6);
    });
  }
});
