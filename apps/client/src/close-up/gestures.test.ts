import { describe, expect, it } from 'vitest';
import { GESTURE } from './close-up-config.js';
import { GestureReader, onTarget, type Gesture, type ScreenTarget } from './gestures.js';

/** A squishy in the middle of a phone screen. */
const TARGET: ScreenTarget = { x: 200, y: 300, rx: 80, ry: 90 };

function reader() {
  const seen: Gesture[] = [];
  const r = new GestureReader(
    () => TARGET,
    (g) => seen.push(g),
  );
  return { r, seen };
}

describe('onTarget', () => {
  it('is an ellipse with a little slop for small fingers', () => {
    expect(onTarget(TARGET, 200, 300)).toBe(true);
    expect(onTarget(TARGET, 200 + 80 * (1 + GESTURE.hitSlop) - 1, 300)).toBe(true);
    expect(onTarget(TARGET, 200 + 80 * (1 + GESTURE.hitSlop) + 1, 300)).toBe(false);
    expect(onTarget(TARGET, 200, 300 + 95, 0)).toBe(false);
    expect(onTarget({ ...TARGET, rx: 0 }, 200, 300)).toBe(false);
  });
});

describe('GestureReader', () => {
  it('boops on a quick still tap on the squishy, not off it', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 200, y: 300, t: 0 });
    r.up({ id: 1, x: 203, y: 302, t: 120 });
    r.down({ id: 2, x: 20, y: 40, t: 500 });
    r.up({ id: 2, x: 20, y: 40, t: 560 });
    expect(seen).toEqual(['boop']);
  });

  it("doesn't boop on a long press", () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 200, y: 300, t: 0 });
    r.up({ id: 1, x: 200, y: 300, t: GESTURE.tapMs + 1 });
    expect(seen).toEqual([]);
  });

  it('pets on a stroke across the squishy, once per touch', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 150, y: 300, t: 0 });
    for (let i = 1; i <= 20; i++) r.move({ id: 1, x: 150 + i * 5, y: 300, t: i * 16 });
    for (let i = 1; i <= 20; i++) r.move({ id: 1, x: 250 - i * 5, y: 300, t: 400 + i * 16 });
    r.up({ id: 1, x: 150, y: 300, t: 800 });
    expect(seen).toEqual(['stroke']);
  });

  it('only counts the part of a stroke that is over the squishy', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 10, y: 10, t: 0 });
    for (let i = 1; i <= 30; i++) r.move({ id: 1, x: 10 + i * 5, y: 10, t: i * 16 });
    r.up({ id: 1, x: 160, y: 10, t: 600 });
    expect(seen).toEqual([]);
  });

  it('tickles on a pinch near the squishy, once per pinch', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 180, y: 300, t: 0 });
    r.down({ id: 2, x: 220, y: 300, t: 5 });
    for (let i = 1; i <= 10; i++) {
      r.move({ id: 1, x: 180 - i * 4, y: 300, t: i * 16 });
      r.move({ id: 2, x: 220 + i * 4, y: 300, t: i * 16 });
    }
    r.up({ id: 1, x: 140, y: 300, t: 300 });
    r.up({ id: 2, x: 260, y: 300, t: 310 });
    expect(seen).toEqual(['tickle']);
  });

  it("doesn't tickle on a pinch far from the squishy", () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 20, y: 700, t: 0 });
    r.down({ id: 2, x: 60, y: 700, t: 5 });
    r.move({ id: 1, x: 0, y: 700, t: 50 });
    r.move({ id: 2, x: 90, y: 700, t: 50 });
    r.up({ id: 1, x: 0, y: 700, t: 100 });
    r.up({ id: 2, x: 90, y: 700, t: 100 });
    expect(seen).toEqual([]);
  });

  it('goes back on a quick swipe down that started off the squishy', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 200, y: 60, t: 0 });
    r.move({ id: 1, x: 205, y: 120, t: 100 });
    r.up({ id: 1, x: 210, y: 60 + GESTURE.swipePx + 10, t: 200 });
    expect(seen).toEqual(['back']);
  });

  it('treats a downward drag on the squishy as petting, not leaving', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 200, y: 230, t: 0 });
    for (let i = 1; i <= 10; i++) r.move({ id: 1, x: 200, y: 230 + i * 14, t: i * 16 });
    r.up({ id: 1, x: 200, y: 370, t: 200 });
    expect(seen).toEqual(['stroke']);
  });

  it('a second finger cancels a boop, and a cancelled touch counts for nothing', () => {
    const { r, seen } = reader();
    r.down({ id: 1, x: 200, y: 300, t: 0 });
    r.down({ id: 2, x: 210, y: 300, t: 10 });
    r.up({ id: 2, x: 210, y: 300, t: 40 });
    r.up({ id: 1, x: 200, y: 300, t: 50 });
    r.down({ id: 3, x: 200, y: 300, t: 100 });
    r.cancel({ id: 3, x: 200, y: 300, t: 120 });
    expect(seen).toEqual([]);
    expect(r.fingers).toBe(0);
  });
});
