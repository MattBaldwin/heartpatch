/**
 * Render on demand (tech spec §6 "Memory and heat"). Babylon has no built-in
 * render-on-demand, so the render loop asks this each iteration whether to
 * draw. A static map draws nothing, which saves battery and heat; a moving
 * camera, a fling or a running animation draws every frame.
 *
 * It also decides which frame times the resolution governor may see: only the
 * gap between two consecutive drawn frames is a real frame time. The gap after
 * an idle stretch is not, so the governor is effectively paused while idle.
 *
 * Under a frame cap (`FrameCap`: explore and `?cap30=1`, #501) frames go in
 * slots every `1000 / fps` ms on a fixed schedule, not timed from the last
 * draw: a callback that runs late doesn't pull the next frame early, so a
 * 60 Hz display holds every other frame and any display averages the cap.
 * Right after a draw that ran late (within one slot) the next gap can be
 * short once; the governor, on `cappedScaler`, reads that as on target.
 *
 * Pure (time is passed in) so it is unit-tested without a GPU.
 */
import type { FrameCap } from './config.js';

export class FrameScheduler {
  private pending: number;
  private lastDrawAt: number | null = null;
  private drewLast = false;
  private readonly settleFrames: number;
  private readonly cap: FrameCap | null;
  /** Under a cap: when the next frame's slot starts. */
  private due: number | null = null;
  /** Frames drawn so far (dev overlay and tests). */
  draws = 0;

  /**
   * @param settleFrames frames to draw after each invalidation
   * @param cap the most frames a second, or null to draw at the display's rate
   */
  constructor(settleFrames: number, cap: FrameCap | null = null) {
    this.settleFrames = settleFrames;
    this.pending = settleFrames;
    this.cap = cap;
  }

  /** Something changed that isn't tracked by `busy` (resize, quality, store update). */
  invalidate(): void {
    this.pending = Math.max(this.pending, this.settleFrames);
  }

  /**
   * Draw exactly one more frame, no settle frames: for a slow idle animation
   * (breathing squishies) that paces itself below the display rate. Calling
   * it every 33 ms draws about 30 fps on any display; `invalidate` would
   * draw `settleFrames` per call and so nearly every frame.
   */
  requestFrame(): void {
    this.pending = Math.max(this.pending, 1);
  }

  /**
   * One render-loop iteration at time `now` (ms). `busy` is true while
   * something animates: camera motion, a fling, Babylon animations, or the
   * scene still loading.
   */
  next(now: number, busy: boolean): { draw: boolean; frameMs: number | null } {
    const draw = busy || this.pending > 0;
    if (!draw) {
      this.drewLast = false;
      return { draw, frameMs: null };
    }
    // Too soon under a cap: skip this one without spending the request, and
    // without ending the run of drawn frames, so the next frame's time is real.
    if (this.cap && this.due !== null && now < this.due - this.cap.earlyMs) {
      return { draw: false, frameMs: null };
    }
    if (this.cap) {
      const period = 1000 / this.cap.fps;
      // The next slot, or a fresh schedule after an idle stretch or a stall.
      this.due = this.due !== null && now - this.due < period ? this.due + period : now + period;
    }
    this.pending = Math.max(0, this.pending - 1);
    const frameMs = this.drewLast && this.lastDrawAt !== null ? now - this.lastDrawAt : null;
    this.lastDrawAt = now;
    this.drewLast = true;
    this.draws++;
    return { draw, frameMs };
  }

  /** True when the last iteration drew nothing. */
  get idle(): boolean {
    return !this.drewLast;
  }
}
