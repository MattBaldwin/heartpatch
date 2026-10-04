import type { CinematicState } from '@heartpatch/shared';

// Skipping and the viewed flag (design doc §25): the cinematic plays once by
// itself, right after the Keeper pick. Once seen it can be skipped with a
// tap; the first time, a long press skips it too, so a kid is never stuck.
// Short taps advance the captions.

export const PRESS = {
  /** A press shorter than this is a tap: the next caption. */
  tapMaxMs: 350, // TUNE
  /** Hold this long to skip. */
  holdMs: 1200, // TUNE
  /** The hold ring shows after this long, so a tap never flashes it. */
  ringAfterMs: 250, // TUNE
} as const;

export type PressKind = 'tap' | 'hold' | 'none';

/** What a press that lasted `ms` was: a tap, a long press, or neither (let go too soon). */
export function classifyPress(ms: number): PressKind {
  if (ms < PRESS.tapMaxMs) return 'tap';
  return ms >= PRESS.holdMs ? 'hold' : 'none';
}

/** How full the hold ring is after holding for `ms` (0 until it shows, 1 when it skips). */
export function holdProgress(ms: number): number {
  if (ms < PRESS.ringAfterMs) return 0;
  return Math.min(1, (ms - PRESS.ringAfterMs) / (PRESS.holdMs - PRESS.ringAfterMs));
}

/**
 * Plays by itself only for an account that has never seen it. If the
 * server couldn't say (null), the game goes on: a kid is never held up, and
 * Settings can still play it.
 */
export function shouldAutoPlay(state: CinematicState | null): boolean {
  return state !== null && state.seenAt === null;
}

/** Offers a Skip button once it has been seen (a replay, or a second device). */
export function canSkip(state: CinematicState | null): boolean {
  return state?.seenAt != null;
}

/** The player asked for less motion (OS setting): gentler camera, no flicker. */
export function prefersReducedMotion(
  media: Pick<Window, 'matchMedia'> | null = typeof window === 'undefined' ? null : window,
): boolean {
  try {
    return media?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
