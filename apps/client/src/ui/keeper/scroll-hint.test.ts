import { describe, expect, it } from 'vitest';
import { moreAttr, scrollMore } from './scroll-hint.js';

describe('Keeper picker scroll hints (#130)', () => {
  it('shows more past the end until the end is reached', () => {
    expect(moreAttr(scrollMore(0, 240, 470))).toBe('end');
    expect(moreAttr(scrollMore(100, 240, 470))).toBe('both');
    expect(moreAttr(scrollMore(230, 240, 470))).toBe('start');
  });

  it('shows nothing when everything fits, allowing for subpixel rounding', () => {
    expect(moreAttr(scrollMore(0, 240, 240))).toBe('none');
    expect(moreAttr(scrollMore(0, 240, 241.5))).toBe('none');
    expect(moreAttr(scrollMore(1, 240, 241))).toBe('none');
  });
});
