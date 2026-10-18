import { describe, expect, it, vi } from 'vitest';
import { TAP_MAX_MOVE_PX } from '../map/tap-detector.js';
import { framedFocus, panPerPixel, type FramedSpot } from './house-camera.js';
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

function panner(bounds: () => HouseBounds = () => two) {
  const focus = vi.fn(framedFocus);
  const outside = vi.fn();
  const measure = vi.fn(() => ({ vp, bounds: bounds(), room: { minX: 0, maxX: 4.8 }, spots }));
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

  it('never jumps by the gap between two fingers after a pinch (B4 review)', () => {
    const { pan } = panner();
    const start = pan.fit();
    // Finger A drags a little, finger B lands (a pinch that clamps back to the dollhouse).
    pan.down(300, 1);
    pan.move(280, 1);
    pan.move(270, 1);
    pan.step();
    const before = pan.pan;
    pan.down(100, 2);
    // A lifts; B (200 px away) moves on its own.
    pan.up(1);
    expect(pan.move(105, 2)).toBe(false);
    expect(pan.step()).toBeNull();
    expect(pan.pan).toBe(before);
    // B drags from where it is: the house follows B's travel only.
    pan.move(105 + TAP_MAX_MOVE_PX + 1, 2);
    pan.move(105 + TAP_MAX_MOVE_PX + 11, 2);
    pan.step();
    // 10 px of B's travel, not the 165 px from A's last spot.
    expect(before - pan.pan).toBeCloseTo(10 * panPerPixel(start.base, vp), 6);
    pan.up(2);
    // Or B lifts first, and A, moved while B was down, starts over where it is.
    pan.down(300, 3);
    pan.down(100, 4);
    pan.up(4);
    const held = pan.pan;
    expect(pan.move(40, 3)).toBe(false);
    pan.step();
    expect(pan.pan).toBe(held);
  });

  it('keeps a drag inside the new limits when a fit narrows them mid-drag', () => {
    let bounds = two;
    const { pan } = panner(() => bounds);
    pan.fit();
    pan.down(390, 1);
    pan.move(370, 1);
    pan.move(-3000, 1);
    pan.step();
    expect(pan.pan).toBe(pan.limits.max);
    const wide = pan.limits.max;
    // The floor switch (or a turn) refits to a narrower house while the finger is still down.
    bounds = { ...two, maxX: 7.2 };
    pan.fit();
    expect(pan.limits.max).toBeLessThan(wide);
    expect(pan.pan).toBeLessThanOrEqual(pan.limits.max);
    expect(pan.pan).toBeGreaterThanOrEqual(pan.limits.min);
    // Dragging on stays inside them too.
    pan.move(-3500, 1);
    pan.step();
    expect(pan.pan).toBe(pan.limits.max);
    pan.up(1);
  });
});
