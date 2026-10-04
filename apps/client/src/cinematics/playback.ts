import { classifyPress, holdProgress, PRESS } from './skip.js';
import { cuesBetween, nextStop, type TimedCue, type Timeline } from './timeline.js';

// The cinematic's clock and controls, without the DOM or the renderer, so
// the rules are unit-tested: time runs with the frames (a hidden tab or a
// hitch never jumps ahead), a tap jumps to the next caption, a long press
// skips, and Skip works once the player has seen it.

/** How it ended: watched to the end (taps included), or skipped. */
export type PlaybackEnd = 'watched' | 'skipped';

/** Longest step one frame may take, seconds (a hidden tab comes back where it left off). */
export const MAX_FRAME_S = 0.1;

export class Playback {
  readonly timeline: Timeline;
  /** Skip button on offer (it has been seen before). */
  readonly skippable: boolean;
  #t = 0;
  #ended: PlaybackEnd | null = null;
  #pressedAt: number | null = null;

  constructor(timeline: Timeline, options: { skippable: boolean }) {
    this.timeline = timeline;
    this.skippable = options.skippable;
  }

  /** Seconds into the cinematic. */
  get t(): number {
    return this.#t;
  }

  get ended(): PlaybackEnd | null {
    return this.#ended;
  }

  /** Runs time on by one frame (`dt` seconds); returns the cues that came due. */
  step(dt: number): TimedCue[] {
    if (this.#ended) return [];
    const from = this.#t;
    this.#t = Math.min(this.timeline.total, from + Math.min(Math.max(dt, 0), MAX_FRAME_S));
    const cues = cuesBetween(this.timeline, from, this.#t);
    if (this.#t >= this.timeline.total) this.#ended = 'watched';
    return cues;
  }

  /** A tap: on to the next caption (no cues fire for what was jumped over). */
  tap(): void {
    if (this.#ended) return;
    this.#t = nextStop(this.timeline, this.#t);
    if (this.#t >= this.timeline.total) this.#ended = 'watched';
  }

  /** The Skip button: only once it has been seen. */
  skip(): boolean {
    if (this.#ended || !this.skippable) return false;
    this.#ended = 'skipped';
    return true;
  }

  /** A finger (or mouse button) goes down, at `now` ms. */
  pressStart(now: number): void {
    if (this.#ended) return;
    this.#pressedAt = now;
  }

  /** It comes up: a short press is a tap; a long one already skipped in `holdTick`. */
  pressEnd(now: number): void {
    const at = this.#pressedAt;
    this.#pressedAt = null;
    if (at === null || this.#ended) return;
    if (classifyPress(now - at) === 'tap') this.tap();
  }

  /** The press was taken away (a system gesture, a scroll): neither a tap nor a hold. */
  pressCancel(): void {
    this.#pressedAt = null;
  }

  /**
   * Checks a press still held at `now` ms: held long enough, it skips, even
   * the first time (design doc §25, so a kid is never stuck). Returns how
   * full the hold ring is.
   */
  holdTick(now: number): number {
    const at = this.#pressedAt;
    if (at === null || this.#ended) return 0;
    if (now - at >= PRESS.holdMs) {
      this.#pressedAt = null;
      this.#ended = 'skipped';
      return 1;
    }
    return holdProgress(now - at);
  }
}
