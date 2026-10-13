import { describe, expect, it } from 'vitest';
import { fitHouse, project, type HouseViewport } from './house-camera.js';
import {
  frameKey,
  framedRoomId,
  framesAboveSheet,
  sheetBands,
  type FrameState,
} from './house-frame.js';
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

describe('framing the house above the sheet when it points at a room (C2b)', () => {
  const state = (sheet: string, over: Partial<FrameState> = {}): FrameState => ({
    sheet,
    pickRoom: 'playroom',
    chosenRoom: null,
    movedRoom: null,
    ...over,
  });

  it('frames the room the sheet is about: the picker’s, the leaving resident’s', () => {
    expect(framedRoomId(state('picker'))).toBe('playroom');
    expect(framedRoomId(state('move-out', { chosenRoom: 'snug' }))).toBe('snug');
    expect(framesAboveSheet(state('picker'))).toBe(true);
  });

  it('frames an opened bed’s room, and the room just moved into while its line shows', () => {
    expect(framedRoomId(state('open', { chosenRoom: 'snug' }))).toBe('snug');
    expect(framedRoomId(state('open', { movedRoom: 'playroom' }))).toBe('playroom');
    // An opened bed wins over the last move.
    expect(framedRoomId(state('open', { chosenRoom: 'snug', movedRoom: 'playroom' }))).toBe('snug');
    // The plain beds, the peek, Grow and its confirm frame as B4 does.
    expect(framesAboveSheet(state('open'))).toBe(false);
    for (const s of ['peek', 'grow', 'confirm']) {
      expect(framedRoomId(state(s, { chosenRoom: 'snug', movedRoom: 'snug' }))).toBeNull();
    }
  });

  it('refits only when the framed room or the sheet’s size step changes', () => {
    const picker = state('picker');
    expect(frameKey(picker, 470)).toBe(frameKey(picker, 480));
    expect(frameKey(picker, 470)).not.toBe(frameKey(picker, 560));
    expect(frameKey(picker, 470)).not.toBe(frameKey(state('picker', { pickRoom: 'snug' }), 470));
    expect(frameKey(state('open'), 470)).toBe('');
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
