/**
 * GPU frame latency without blocking (#501 PR A). After a `scene.render`, at
 * most every `minGapMs`, the stage drops a WebGL2 fence into the command
 * stream; on later frames, and on a short timer between them (`poll`), it
 * asks with a zero timeout which fences the GPU has passed. A fence's latency is the time from the
 * frame that queued it to the first check that saw it passed, so it is
 * rounded up to the check interval. Next to the frame gap and our
 * `scene.render` time it tells a stalled GPU (latency near the gap, fences
 * piling up) from a browser that is slow to hand us frames (latency well
 * under the gap).
 *
 * The WebGL calls come in through `FenceOps`, so this is a pure state
 * machine (time is passed in) and is unit-tested without a GPU.
 */
export interface FenceOps<F> {
  /** A new fence after the commands queued so far, or null if the context can't make one. */
  create(): F | null;
  /** Whether the GPU has passed it; never waits. `lost`: it never will (the context was lost). */
  check(fence: F): 'passed' | 'pending' | 'lost';
  delete(fence: F): void;
}

export interface GpuLatency {
  /** The last fence that passed, in ms from the frame that queued it. */
  readonly lastMs: number;
  /** Mean and worst over the last `GPU_WINDOW` passed fences. */
  readonly avgMs: number;
  readonly maxMs: number;
  /** Fences queued but not passed yet. */
  readonly pending: number;
  /** Fences passed since this poller started. */
  readonly passed: number;
}

/** Fences in flight at most; a GPU this far behind has already told us what we need. */
export const MAX_PENDING_FENCES = 4; // TUNE
/** Passed fences averaged over. */
export const GPU_WINDOW = 30; // TUNE

/** How a `FencePoller` samples. */
export interface FenceOptions {
  /**
   * The minimum time between two fences, in ms. A frame sooner than this after
   * the last fence queues none, so a fast loop fences a few times a second
   * while every frame of a slow run (each this long or longer) still gets one.
   * 0 fences every frame.
   */
  readonly minGapMs?: number;
}

export class FencePoller<F> {
  readonly #ops: FenceOps<F>;
  readonly #minGapMs: number;
  readonly #pending: { fence: F; at: number }[] = [];
  readonly #recent: number[] = [];
  #last: number | null = null;
  #passed = 0;
  /** When the last fence was queued, or null before the first. */
  #lastFenceAt: number | null = null;

  constructor(ops: FenceOps<F>, { minGapMs = 0 }: FenceOptions = {}) {
    this.#ops = ops;
    this.#minGapMs = minGapMs;
  }

  /**
   * One drawn frame at `now`, right after `scene.render`: resolves the fences
   * the GPU has passed since the last frame (oldest first; the GPU runs them
   * in order, so the first one still pending ends the check), then queues
   * one for this frame unless `MAX_PENDING_FENCES` are already in flight or
   * the last one was queued under `minGapMs` ago.
   */
  frame(now: number): void {
    this.poll(now);
    if (this.#pending.length >= MAX_PENDING_FENCES) return;
    if (this.#lastFenceAt !== null && now - this.#lastFenceAt < this.#minGapMs) return;
    const fence = this.#ops.create();
    if (fence === null) return;
    this.#pending.push({ fence, at: now });
    this.#lastFenceAt = now;
  }

  /** Resolves the fences passed by `now`, between frames too. */
  poll(now: number): void {
    for (;;) {
      const oldest = this.#pending[0];
      if (!oldest) break;
      const status = this.#ops.check(oldest.fence);
      if (status === 'lost') {
        this.dispose(); // none of them will pass; nothing to time
        break;
      }
      if (status === 'pending') break;
      this.#pending.shift();
      this.#ops.delete(oldest.fence);
      this.#record(now - oldest.at);
    }
  }

  /** Fences queued and not passed yet. */
  get pending(): number {
    return this.#pending.length;
  }

  /** The readings so far, or null before the first fence has passed. */
  get latency(): GpuLatency | null {
    if (this.#last === null) return null;
    let sum = 0;
    let max = 0;
    for (const ms of this.#recent) {
      sum += ms;
      max = Math.max(max, ms);
    }
    return {
      lastMs: this.#last,
      avgMs: sum / this.#recent.length,
      maxMs: max,
      pending: this.#pending.length,
      passed: this.#passed,
    };
  }

  /** Frees every fence still in flight (the stage is going away). */
  dispose(): void {
    for (const { fence } of this.#pending) this.#ops.delete(fence);
    this.#pending.length = 0;
  }

  #record(ms: number): void {
    this.#last = ms;
    this.#passed++;
    this.#recent.push(ms);
    if (this.#recent.length > GPU_WINDOW) this.#recent.shift();
  }
}

/** The WebGL2 calls `webglFenceOps` makes (a structural slice of WebGL2RenderingContext). */
export interface FenceGl {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly ALREADY_SIGNALED: number;
  readonly CONDITION_SATISFIED: number;
  readonly WAIT_FAILED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  clientWaitSync(sync: WebGLSync, flags: number, timeout: number): number;
  deleteSync(sync: WebGLSync | null): void;
}

/**
 * Fence calls on a WebGL2 context. `clientWaitSync` with a zero timeout only
 * reads the fence's status (WebGL updates it between tasks, so a fence never
 * passes in the frame that queued it).
 */
export function webglFenceOps(gl: FenceGl): FenceOps<WebGLSync> {
  return {
    create: () => gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0),
    check: (sync) => {
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return 'passed';
      return status === gl.WAIT_FAILED ? 'lost' : 'pending';
    },
    delete: (sync) => {
      gl.deleteSync(sync);
    },
  };
}
