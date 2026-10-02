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
 * Pure (time is passed in) so it is unit-tested without a GPU.
 */
export class FrameScheduler {
  private pending: number;
  private lastDrawAt: number | null = null;
  private drewLast = false;
  private readonly settleFrames: number;
  /** Frames drawn so far (dev overlay and tests). */
  draws = 0;

  /** @param settleFrames frames to draw after each invalidation */
  constructor(settleFrames: number) {
    this.settleFrames = settleFrames;
    this.pending = settleFrames;
  }

  /** Something changed that isn't tracked by `busy` (resize, quality, store update). */
  invalidate(): void {
    this.pending = Math.max(this.pending, this.settleFrames);
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
