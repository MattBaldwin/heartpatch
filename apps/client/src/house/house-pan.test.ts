import { describe, expect, it, vi } from 'vitest';
import { TAP_MAX_MOVE_PX } from '../map/tap-detector.js';
import { framedFocus, type FramedSpot } from './house-camera.js';
import type { HouseBounds } from './house-layout.js';
import { createHousePan } from './house-pan.js';

// Level 2 on an iPhone: the Snug and the Playroom side by side.
const two: HouseBounds = { minX: -0.24, maxX: 9.84, minY: 0, maxY: 3, minZ: -0.35, maxZ: 5.04 };
const vp = { width: 390, height: 844, top: 70, bottom: 148, sheet: 68 };
const spots: FramedSpot[] = [
  { x: 1.6, y: 0.6, z: 1.9, r: 0.6 },
  { x: 3.2, y: 0.6, z: 1.7, r: 0.6 },
  { x: 6.4, y: 0.6, z: 1.7, r: 0.6 },
  { x: 7.6, y: 0.4, z: 2.1, r: 0.45 },
];

function panner() {
  const focus = vi.fn(framedFocus);
  const outside = vi.fn();
  const measure = vi.fn(() => ({ vp, bounds: two, room: { minX: 0, maxX: 4.8 }, spots }));
  const pan = createHousePan({ measure, frameOutside: outside, framedFocus: focus });
  return { pan, focus, outside, measure };
}

describe('house pan: the sideways drag on a tall phone (B4 review)', () => {
  it('fits once, then slides per frame without refitting or re-framing the trees per move', () => {
    const { pan, focus, outside, measure } = panner();
    const fitted = pan.fit();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(outside).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    pan.down(300);
    // Thirty moves leftward (the house slides to show the Playroom), two frames drawn.
    for (let i = 1; i <= 30; i++) {
      pan.move(300 - i * 4);
      if (i === 15 || i === 30) pan.step();
    }
    expect(focus).toHaveBeenCalledTimes(1);
    expect(outside).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(pan.pan).toBeGreaterThan(0);
    // Lifting the finger re-frames the trees once.
    const last = pan.up();
    expect(outside).toHaveBeenCalledTimes(2);
    expect(last?.base.target.x).toBeGreaterThan(fitted.base.target.x);
  });

  it('keeps a tap’s jitter from sliding the house, and stays inside the house’s ends', () => {
    const { pan } = panner();
    pan.fit();
    pan.down(200);
    expect(pan.move(200 + TAP_MAX_MOVE_PX)).toBe(false);
    expect(pan.step()).toBeNull();
    // A long drag the other way stops at the house's left end.
    expect(pan.move(200 + TAP_MAX_MOVE_PX + 1)).toBe(true);
    pan.move(900);
    pan.step();
    expect(pan.pan).toBe(pan.limits.min);
    pan.up();
    pan.down(390);
    pan.move(370);
    pan.move(-3000);
    pan.step();
    expect(pan.pan).toBe(pan.limits.max);
  });

  it('puts the chevrons clear of every resident and starts over on reset', () => {
    const { pan } = panner();
    const frame = pan.fit();
    expect(frame.cues.right.x1).toBeLessThanOrEqual(vp.width);
    expect(frame.cues.left.x0).toBeGreaterThanOrEqual(0);
    pan.down(300);
    pan.move(250);
    pan.move(100);
    pan.step();
    pan.up();
    pan.reset();
    expect(pan.pan).toBe(0);
  });
});
