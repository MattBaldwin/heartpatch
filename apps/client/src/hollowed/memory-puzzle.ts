import { HOLLOWED_EXPLORE } from './hollowed-config.js';

/*
 * A grey village tile's memory puzzle (#306 PR 2b), as the card plays it:
 * the broken thing shows its pieces in order (each lights up in turn), then
 * the kid taps them back in the same order. A wrong tap just wobbles: no
 * score, no fail. After a couple of wrong taps the next piece glows by
 * itself, and the easy way puts the next piece back for you, so nobody gets
 * stuck (like #199's mini-interactions). It's feel, not outcome: the server
 * checks the order and rolls the reward (CLAUDE.md rule 1). A pure reducer
 * fed with times, so every case is unit-tested.
 */

export type PuzzlePhase = 'watch' | 'play' | 'done';

export interface PuzzleState {
  /** The pieces in the order they go back in (`HollowedPuzzle.order`). */
  readonly order: readonly string[];
  /** The tray: the same pieces, shuffled, as the kid picks from them. */
  readonly tray: readonly string[];
  /** The pieces put back so far, in order. */
  readonly placed: readonly string[];
  readonly phase: PuzzlePhase;
  /** When the current showing of the order started (ms). */
  readonly watchSince: number;
  /** Wrong taps since the last right one. */
  readonly misses: number;
  /** The piece that wobbled (a wrong tap) and when, or null. */
  readonly wobble: { readonly id: string; readonly at: number } | null;
}

export type PuzzleInput =
  /** Time passed (the showing moves on, a wobble settles). */
  | { readonly type: 'tick'; readonly t: number }
  /** "I'm ready!": skip the rest of the showing. */
  | { readonly type: 'ready'; readonly t: number }
  /** "Show me again": the order plays once more; what's placed stays. */
  | { readonly type: 'again'; readonly t: number }
  /** A piece in the tray was tapped. */
  | { readonly type: 'tap'; readonly id: string; readonly t: number }
  /** The easy way: the next piece goes back by itself. */
  | { readonly type: 'easy'; readonly t: number };

/**
 * A fresh puzzle. `seed01` (0–1) shuffles the tray, so the same tile lays its
 * pieces out the same way each time; the tray is never already in order.
 */
export function startPuzzle(order: readonly string[], t: number, seed01 = 0.5): PuzzleState {
  return {
    order,
    tray: trayOf(order, seed01),
    placed: [],
    phase: 'watch',
    watchSince: t,
    misses: 0,
    wobble: null,
  };
}

/** How long one showing of the order lasts, ms. */
export function watchMs(pieces: number): number {
  const { showMs, gapMs } = HOLLOWED_EXPLORE.puzzle;
  return pieces * (showMs + gapMs);
}

/** The piece lit up in the showing at `t`, or null (between pieces, or not showing). */
export function showing(s: PuzzleState, t: number): string | null {
  if (s.phase !== 'watch') return null;
  const { showMs, gapMs } = HOLLOWED_EXPLORE.puzzle;
  const into = t - s.watchSince;
  if (into < 0) return null;
  const i = Math.floor(into / (showMs + gapMs));
  if (i >= s.order.length || into - i * (showMs + gapMs) >= showMs) return null;
  return s.order[i] ?? null;
}

/** The next piece to put back, or null once it's whole. */
export function nextPiece(s: PuzzleState): string | null {
  return s.order[s.placed.length] ?? null;
}

/** The piece that glows to help (after a few wrong taps), or null. */
export function glowing(s: PuzzleState): string | null {
  if (s.phase !== 'play' || s.misses < HOLLOWED_EXPLORE.puzzle.missesForGlow) return null;
  return nextPiece(s);
}

/** Is `id` wobbling at `t` (a wrong tap just now)? */
export function wobbling(s: PuzzleState, id: string, t: number): boolean {
  return s.wobble?.id === id && t - s.wobble.at < HOLLOWED_EXPLORE.puzzle.wobbleMs;
}

export function stepPuzzle(s: PuzzleState, input: PuzzleInput): PuzzleState {
  if (s.phase === 'done') return s;
  switch (input.type) {
    case 'tick':
      // The showing ends by itself; the kid's turn starts.
      return s.phase === 'watch' && input.t - s.watchSince >= watchMs(s.order.length)
        ? { ...s, phase: 'play' }
        : s;
    case 'ready':
      return s.phase === 'watch' ? { ...s, phase: 'play' } : s;
    case 'again':
      return { ...s, phase: 'watch', watchSince: input.t, wobble: null };
    case 'easy':
      return place(s);
    case 'tap': {
      if (s.placed.includes(input.id) || !s.order.includes(input.id)) return s;
      // A tap while it's still showing means the kid's ready.
      const playing = s.phase === 'watch' ? { ...s, phase: 'play' as const } : s;
      if (input.id === nextPiece(playing)) return place(playing);
      return { ...playing, misses: playing.misses + 1, wobble: { id: input.id, at: input.t } };
    }
  }
}

/** The next piece goes back; the last one makes it whole. */
function place(s: PuzzleState): PuzzleState {
  const next = nextPiece(s);
  if (next === null) return s;
  const placed = [...s.placed, next];
  return {
    ...s,
    placed,
    phase: placed.length === s.order.length ? 'done' : 'play',
    misses: 0,
    wobble: null,
  };
}

/** The tray's order: a seeded rotation and swap of the pieces, never the answer itself. */
function trayOf(order: readonly string[], seed01: number): string[] {
  const n = order.length;
  if (n < 2) return [...order];
  const tray = [...order];
  // Swap pairs by the seed, then turn the row, so it's well mixed and never in order.
  const k = Math.floor(seed01 * 1000);
  for (let i = n - 1; i > 0; i--) {
    const j = (k * (i + 7) + i * 31) % (i + 1);
    const swap = tray[i] as string;
    tray[i] = tray[j] as string;
    tray[j] = swap;
  }
  if (tray.every((id, i) => id === order[i])) tray.push(tray.shift() as string);
  return tray;
}
