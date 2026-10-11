import { describe, expect, it } from 'vitest';
import { opaqueBox } from './portraits.js';

/** A width × height RGBA picture, opaque only where `on(x, y)`. */
function picture(width: number, height: number, on: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (on(x, y)) data[(y * width + x) * 4 + 3] = 255;
  }
  return data;
}

describe('opaqueBox', () => {
  it('finds the drawn squishy, ears and all', () => {
    // A body from (3,5) to (6,8) with one tall ear pixel at (4,1).
    const data = picture(
      10,
      10,
      (x, y) => (x >= 3 && x <= 6 && y >= 5 && y <= 8) || (x === 4 && y === 1),
    );
    expect(opaqueBox(data, 10, 10)).toEqual({ x0: 3, y0: 1, x1: 7, y1: 9 });
  });

  it('ignores nearly see-through edges and says null for an empty picture', () => {
    const faint = new Uint8ClampedArray(4 * 4 * 4).fill(0);
    faint[3] = 4; // alpha 4: anti-aliasing dust
    expect(opaqueBox(faint, 4, 4)).toBeNull();
  });
});
