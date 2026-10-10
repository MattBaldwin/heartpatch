import { describe, expect, it } from 'vitest';
import { intersects } from './geometry.js';

const a = { x: 0, y: 0, width: 10, height: 10 };

describe('intersects', () => {
  it('is true when the rects share area', () => {
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it('is false when they only touch or are apart', () => {
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(intersects(a, { x: 0, y: 10, width: 5, height: 5 })).toBe(false);
    expect(intersects(a, { x: 20, y: 20, width: 5, height: 5 })).toBe(false);
  });
});
