import { describe, expect, it } from 'vitest';
import { HOME_SHEET } from './home-config.js';
import { afterHandle, isStrayClick } from './home-peek.js';

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

describe("the handle tap's own click (#306)", () => {
  const at = { x: 400, y: 1038 };

  it('is the click soon after, where the finger was let go', () => {
    expect(isStrayClick(at, at, 0, HOME_SHEET)).toBe(true);
    expect(isStrayClick(at, { x: 405, y: 1040 }, HOME_SHEET.clickAfterMs - 1, HOME_SHEET)).toBe(
      true,
    );
  });

  it('is not a quick tap somewhere else, a late click, or one with no release', () => {
    expect(isStrayClick(at, { x: 400, y: 1142 }, 50, HOME_SHEET)).toBe(false);
    expect(isStrayClick(at, at, HOME_SHEET.clickAfterMs, HOME_SHEET)).toBe(false);
    expect(isStrayClick(null, at, 0, HOME_SHEET)).toBe(false);
  });
});
