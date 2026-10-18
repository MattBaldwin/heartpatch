/**
 * When to send a perf report (#501 PR A): drawn frames stay under
 * `SLOW_FPS` for `SLOW_FOR_MS`, at most once every `REPORT_EVERY_MS`.
 *
 * Fed the real frame times the stage hands the governor (the gap between two
 * consecutive drawn frames; null after an idle stretch). They are summed into
 * one-second buckets; each bucket is slow or not by its own frame rate, and a
 * run of slow buckets that reaches `SLOW_FOR_MS` fires. A fast bucket, an idle
 * stretch or a pause (a gap longer than `PAUSE_MS`: the tab was hidden, the
 * phone slept) starts over, so only a collapse while playing counts.
 *
 * Pure (time is passed in) so it is unit-tested without a GPU.
 */
export const SLOW_FPS = 10;
export const SLOW_FOR_MS = 5000;
export const REPORT_EVERY_MS = 60_000;
/** One bucket of frames. */
export const BUCKET_MS = 1000;
/** A frame gap this long is a pause, not a slow frame. */
export const PAUSE_MS = 3000; // TUNE: the owner's slowest frames were about 1 s

export interface SlowRun {
  /** Drawn frames per second over the slow run. */
  readonly fps: number;
  /** How long the run lasted. */
  readonly ms: number;
}

export class SlowTrigger {
  #bucketMs = 0;
  #bucketFrames = 0;
  #runMs = 0;
  #runFrames = 0;
  #firedAt: number | null = null;

  /**
   * One drawn frame at `now` that took `frameMs` (null: the first after an
   * idle stretch). Returns the slow run when it's time to report, else null.
   */
  frame(now: number, frameMs: number | null): SlowRun | null {
    if (frameMs === null || frameMs > PAUSE_MS) {
      this.reset();
      return null;
    }
    this.#bucketMs += frameMs;
    this.#bucketFrames++;
    if (this.#bucketMs < BUCKET_MS) return null;
    const slow = (this.#bucketFrames * 1000) / this.#bucketMs < SLOW_FPS;
    if (slow) {
      this.#runMs += this.#bucketMs;
      this.#runFrames += this.#bucketFrames;
    } else {
      this.#runMs = 0;
      this.#runFrames = 0;
    }
    this.#bucketMs = 0;
    this.#bucketFrames = 0;
    if (this.#runMs < SLOW_FOR_MS) return null;
    if (this.#firedAt !== null && now - this.#firedAt < REPORT_EVERY_MS) return null;
    const run = { fps: (this.#runFrames * 1000) / this.#runMs, ms: this.#runMs };
    this.#firedAt = now;
    this.#runMs = 0;
    this.#runFrames = 0;
    return run;
  }

  /** True while the frames so far are part of a slow run (the badge reader starts here). */
  get slowing(): boolean {
    return this.#runMs > 0;
  }

  /** Starts over (a new scene, an idle stretch, a pause); the once-a-minute limit stays. */
  reset(): void {
    this.#bucketMs = 0;
    this.#bucketFrames = 0;
    this.#runMs = 0;
    this.#runFrames = 0;
  }
}
