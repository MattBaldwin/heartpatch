import { describe, expect, it } from 'vitest';
import {
  canSkip,
  classifyPress,
  holdProgress,
  prefersReducedMotion,
  PRESS,
  shouldAutoPlay,
} from './skip.js';

describe('skipping and the viewed flag', () => {
  it('plays by itself once, only for an account that has never seen it', () => {
    expect(shouldAutoPlay({ seenAt: null })).toBe(true);
    expect(shouldAutoPlay({ seenAt: '2026-10-04T12:00:00.000Z' })).toBe(false);
    // The server couldn't say: the game goes on rather than hold a kid up.
    expect(shouldAutoPlay(null)).toBe(false);
  });

  it('offers Skip once it has been seen, never the first time', () => {
    expect(canSkip({ seenAt: '2026-10-04T12:00:00.000Z' })).toBe(true);
    expect(canSkip({ seenAt: null })).toBe(false);
    expect(canSkip(null)).toBe(false);
  });

  it('tells a tap from a long press, and ignores a press let go in between', () => {
    expect(classifyPress(0)).toBe('tap');
    expect(classifyPress(PRESS.tapMaxMs - 1)).toBe('tap');
    expect(classifyPress(PRESS.tapMaxMs)).toBe('none');
    expect(classifyPress(PRESS.holdMs - 1)).toBe('none');
    expect(classifyPress(PRESS.holdMs)).toBe('hold');
  });

  it('fills the hold ring only once a press is clearly not a tap', () => {
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(PRESS.ringAfterMs - 1)).toBe(0);
    expect(holdProgress((PRESS.ringAfterMs + PRESS.holdMs) / 2)).toBeCloseTo(0.5);
    expect(holdProgress(PRESS.holdMs)).toBe(1);
    expect(holdProgress(PRESS.holdMs * 3)).toBe(1);
  });

  it('reads prefers-reduced-motion, and copes without matchMedia', () => {
    const media = (matches: boolean) => ({
      matchMedia: (q: string) => ({ matches: matches && q.includes('reduce') }) as MediaQueryList,
    });
    expect(prefersReducedMotion(media(true))).toBe(true);
    expect(prefersReducedMotion(media(false))).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
    const broken = {
      matchMedia: () => {
        throw new Error('nope');
      },
    };
    expect(prefersReducedMotion(broken)).toBe(false);
  });
});
