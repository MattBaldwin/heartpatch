import { describe, expect, it } from 'vitest';
import { HOME_SHEET } from './home-config.js';
import { afterHandle } from './home-peek.js';

describe('the home sheet handle (#412)', () => {
  const swipe = HOME_SHEET.swipePx;

  it('toggles on a tap', () => {
    expect(afterHandle(false, 0, swipe)).toBe(true);
    expect(afterHandle(true, 0, swipe)).toBe(false);
    expect(afterHandle(false, swipe - 1, swipe)).toBe(true);
    expect(afterHandle(true, -(swipe - 1), swipe)).toBe(false);
  });

  it('opens on a swipe up, whatever it was', () => {
    expect(afterHandle(false, -swipe, swipe)).toBe(true);
    expect(afterHandle(true, -swipe * 3, swipe)).toBe(true);
  });

  it('folds on a swipe down, whatever it was', () => {
    expect(afterHandle(true, swipe, swipe)).toBe(false);
    expect(afterHandle(false, swipe * 3, swipe)).toBe(false);
  });
});
