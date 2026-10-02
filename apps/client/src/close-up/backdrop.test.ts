import { describe, expect, it } from 'vitest';
import { backdropSize, boxBlur, tint } from './backdrop.js';

/** A w×h RGBA image, every pixel from `at(x, y)`. */
function image(w: number, h: number, at: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x, y);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return data;
}

describe('boxBlur', () => {
  it('leaves a flat image flat', () => {
    const data = image(8, 6, () => 120);
    boxBlur(data, 8, 6, 2, 3);
    expect([...new Set(data)]).toEqual([120, 255]);
  });

  it('softens a hard edge and keeps the overall brightness', () => {
    const w = 16;
    const data = image(w, 4, (x) => (x < w / 2 ? 0 : 200));
    const before = data.reduce((sum, v) => sum + v, 0);
    boxBlur(data, w, 4, 2, 3);
    const row = Array.from({ length: w }, (_, x) => data[x * 4]!);
    // Monotonic ramp across the edge, no hard step left.
    for (let x = 1; x < w; x++) expect(row[x]!).toBeGreaterThanOrEqual(row[x - 1]!);
    expect(row[w / 2]! - row[w / 2 - 1]!).toBeLessThan(60);
    expect(row[0]).toBe(0);
    expect(row[w - 1]).toBe(200);
    const after = data.reduce((sum, v) => sum + v, 0);
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
  });

  it('does nothing with no radius', () => {
    const data = image(4, 4, (x) => x * 50);
    const copy = new Uint8ClampedArray(data);
    boxBlur(data, 4, 4, 0);
    expect(data).toEqual(copy);
  });
});

describe('tint', () => {
  it('mixes towards a colour and makes it opaque', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 10, 200, 200, 200, 255]);
    tint(data, '#ff8000', 0.5);
    expect([...data]).toEqual([128, 64, 0, 255, 228, 164, 100, 255]);
  });
});

describe('backdropSize', () => {
  it('shrinks to a few dozen pixels, keeping the shape', () => {
    expect(backdropSize(780, 1688, 48)).toEqual({ width: 48, height: 104 });
    expect(backdropSize(20, 10, 48)).toEqual({ width: 20, height: 10 });
  });
});
