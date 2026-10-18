import {
  cleanBadgeLine,
  PERF_MAX_MS,
  type PerfDecision,
  type PerfReport,
} from '@heartpatch/shared';
import { apiCall, ApiRequestError } from '../net/api.js';
import type { BadgeReader } from './badge-lines.js';
import { bisectFlags, bisectLabel } from './bisect-flags.js';
import { FencePoller, webglFenceOps, type FenceGl } from './gpu-fence.js';
import type { QualitySnapshot } from './quality/render-quality.js';
import type { RendererKind } from './renderer.js';
import { SlowTrigger, type SlowRun } from './slow-trigger.js';
import type { Stage } from './stage.js';

/**
 * The on-device perf report (#501 PR A). When drawn frames stay under 10 fps
 * for 5 s (`SlowTrigger`), the stage posts one row to `POST /perf/report`,
 * which the server logs as `perf-report`, at most once a minute. The row says
 * where each slow frame went: the gap between frames, our `scene.render`, and
 * the GPU's latency (`FencePoller`), plus the governor's state and last
 * decisions, the badge lines, how long the page and the scene have been open,
 * whether the page is visible, and which bisect flags are on. The owner just
 * plays; we read the server log. The `?fps=1` badge shows the last report.
 *
 * One `PerfProbe` per stage; the trigger, the decision log and the last
 * report are page-wide, so a scene swap can't reset the once-a-minute limit.
 */

/** Drawn frames the frame-time split averages over. */
export const FRAME_WINDOW = 60; // TUNE
/** Governor decisions a report carries. */
export const DECISIONS_KEPT = 10;

/** Mean and worst of the last `FRAME_WINDOW` drawn frames' gaps and render times. */
export class FrameWindow {
  readonly #gaps: number[] = [];
  readonly #renders: number[] = [];

  /** One drawn frame: the gap since the last one (null after an idle stretch) and `scene.render`'s time. */
  push(gapMs: number | null, renderMs: number): void {
    if (gapMs !== null) keep(this.#gaps, gapMs);
    keep(this.#renders, renderMs);
  }

  /** Drawn frames per second over the window's gaps, or null with none. */
  get fps(): number | null {
    const { avg } = stats(this.#gaps);
    return avg > 0 ? 1000 / avg : null;
  }

  get split(): PerfReport['frames'] {
    return {
      count: this.#renders.length,
      gapMs: stats(this.#gaps),
      renderMs: stats(this.#renders),
    };
  }
}

function keep(list: number[], value: number): void {
  list.push(value);
  if (list.length > FRAME_WINDOW) list.shift();
}

function stats(list: readonly number[]): { avg: number; max: number } {
  if (list.length === 0) return { avg: 0, max: 0 };
  let sum = 0;
  let max = 0;
  for (const v of list) {
    sum += v;
    max = Math.max(max, v);
  }
  return { avg: round(sum / list.length), max: round(max) };
}

/** Two decimals: plenty for ms and fps, and short rows. */
const round = (n: number): number => Math.round(n * 100) / 100;

/** The governor's last `DECISIONS_KEPT` changes of tier or render scale, oldest first. */
export class DecisionLog {
  readonly #entries: PerfDecision[] = [];
  #last: { tier: string; renderScale: number } | null = null;

  /** The governor's state after a sample (or a mount); logged only if it changed. */
  note(
    atMs: number,
    snapshot: Pick<QualitySnapshot, 'tier' | 'renderScale'>,
    fps: number | null,
  ): void {
    const { tier, renderScale } = snapshot;
    const last = this.#last;
    this.#last = { tier, renderScale };
    if (last === null || (last.tier === tier && last.renderScale === renderScale)) return;
    this.#entries.push({
      atMs: round(atMs),
      tier,
      renderScale,
      fps: fps === null ? null : round(fps),
    });
    if (this.#entries.length > DECISIONS_KEPT) this.#entries.shift();
  }

  /** A new stage starts its own governor: its first state isn't a decision. */
  remount(): void {
    this.#last = null;
  }

  get entries(): readonly PerfDecision[] {
    return this.#entries;
  }
}

/** The last report, for the badge. */
export interface ReportStatus {
  /** performance.now() when it fired. */
  readonly at: number;
  readonly fps: number;
  readonly gpuMs: number | null;
  readonly result: 'sending' | 'sent' | 'logged out' | 'failed';
}

/**
 * Between slow frames the fences are also checked on a timer this often, so
 * the GPU's latency reads to about this, not to a whole frame. Only while
 * frames are slower than twice this: at full speed a frame is check enough.
 */
export const FENCE_POLL_MS = 20; // TUNE

/**
 * How far into a slow run the badge counts start (a scene instrumentation and
 * the GL wrappers, for the rest of the page's life). Late enough that a
 * one-off hitch, like shaders compiling as a scene opens, doesn't start them.
 */
const BADGE_START_MS = 3000; // TUNE

/**
 * How long a report waits for the badge lines' chunk before going without
 * them. Roomy: a phone at 1 fps fetches and runs it between frames.
 */
const BADGE_WAIT_MS = 15_000; // TUNE

/** `?slow=1` (dev only): every drawn frame takes at least this long, and the loop keeps drawing. */
export const SLOW_FRAME_MS = 150;

const page = {
  trigger: new SlowTrigger(),
  decisions: new DecisionLog(),
  status: null as ReportStatus | null,
  slow: false,
  /** The badge lines' reader once loaded, and its load (a chunk fetched as a slow run begins). */
  badge: null as BadgeReader | null,
  badgeLoad: null as Promise<unknown> | null,
};

/** `?slow=1`, set once from `main.ts` in a dev build (the e2e check that a report fires). */
export function setSlowFrames(on: boolean): void {
  page.slow = on;
}

export function slowFrames(): boolean {
  return page.slow;
}

/** The last report, or null before one fired. */
export function lastReport(): ReportStatus | null {
  return page.status;
}

/** "report · sent 42 s ago · 3.1 fps · gpu 812 ms", the badge's fourth line. */
export function formatReportStatus(status: ReportStatus | null, now: number): string {
  if (!status) return 'report · none';
  const ago = Math.max(0, Math.round((now - status.at) / 1000));
  const parts = [
    'report',
    `${status.result} ${String(ago)} s ago`,
    `${status.fps.toFixed(1)} fps`,
    status.gpuMs === null ? 'gpu n/a' : `gpu ${String(Math.round(status.gpuMs))} ms`,
  ];
  return parts.join(' · ');
}

/** The context's fence calls, if it's WebGL2 (WebGPU and WebGL1 report no GPU latency). */
function fenceGl(engine: object, kind: RendererKind): FenceGl | null {
  if (kind !== 'webgl2' || typeof WebGL2RenderingContext === 'undefined') return null;
  // `_gl` is Babylon-internal (WebGL's Engine); a WebGPU engine has none. Read
  // structurally, not with `instanceof Engine`, so the stage doesn't import the
  // WebGL engine that renderer.ts loads on demand.
  const gl = (engine as { _gl?: unknown })._gl;
  return gl instanceof WebGL2RenderingContext ? gl : null;
}

/** One stage's frame timing and GPU fences, feeding the page-wide trigger. */
export class PerfProbe {
  readonly #kind: RendererKind;
  readonly #quality: { readonly snapshot: QualitySnapshot };
  /** The stage, once it's built (the badge lines read it). */
  readonly #stage: () => Stage | null;
  readonly #fences: FencePoller<WebGLSync> | null;
  readonly #frames = new FrameWindow();
  readonly #openedAt = performance.now();
  #disposed = false;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    engine: object,
    kind: RendererKind,
    quality: { readonly snapshot: QualitySnapshot },
    stage: () => Stage | null,
  ) {
    this.#kind = kind;
    this.#quality = quality;
    this.#stage = stage;
    const gl = fenceGl(engine, kind);
    this.#fences = gl ? new FencePoller(webglFenceOps(gl)) : null;
    page.trigger.reset();
    page.decisions.remount();
    page.decisions.note(this.#openedAt, quality.snapshot, null);
  }

  /**
   * One drawn frame at `now`, right after `scene.render` (which took
   * `renderMs`): queues this frame's fence, and reports a slow run.
   */
  frame(now: number, frameMs: number | null, renderMs: number): void {
    if (this.#fences) {
      // Queued after the draw, so the latency is the GPU's, not our render's.
      this.#fences.frame(performance.now());
      if (frameMs !== null && frameMs > 2 * FENCE_POLL_MS) this.#pollBetweenFrames();
    }
    this.#frames.push(frameMs, renderMs);
    const run = page.trigger.frame(now, frameMs);
    if (page.trigger.slowMs >= BADGE_START_MS) this.#watchBadge();
    if (run) void this.#report(run, now);
  }

  /** The governor just sampled a frame and wants a change (logged if its tier or scale moved). */
  decided(now: number): void {
    page.decisions.note(now, this.#quality.snapshot, this.#frames.fps);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
    this.#fences?.dispose();
  }

  /** Checks the fences on a timer until none is pending (each check is its own task, so WebGL can update them). */
  #pollBetweenFrames(): void {
    if (this.#pollTimer !== null) return;
    const tick = (): void => {
      this.#pollTimer = null;
      const fences = this.#fences;
      if (!fences || this.#disposed) return;
      fences.poll(performance.now());
      if (fences.pending > 0) this.#pollTimer = setTimeout(tick, FENCE_POLL_MS);
    };
    this.#pollTimer = setTimeout(tick, FENCE_POLL_MS);
  }

  /** Starts the badge counts as a slow run begins, so the report has them (loaded on demand). */
  #watchBadge(): void {
    const stage = this.#stage();
    if (!stage) return;
    if (page.badge) {
      page.badge.watch(stage);
      return;
    }
    page.badgeLoad ??= import('./badge-lines.js').then(
      ({ badgeReader }) => {
        page.badge = badgeReader();
      },
      () => {
        // No chunk (offline): the report goes without the badge lines.
      },
    );
  }

  async #report(run: SlowRun, now: number): Promise<void> {
    page.status = { at: now, fps: run.fps, gpuMs: null, result: 'sending' };
    // The badge lines' chunk is fetched as the run begins; wait for a slow one.
    if (!page.badge && page.badgeLoad) {
      await Promise.race([page.badgeLoad, new Promise((done) => setTimeout(done, BADGE_WAIT_MS))]);
    }
    const gpu = this.#fences?.latency ?? null;
    const stage = this.#stage();
    const snapshot = this.#quality.snapshot;
    const flags = bisectLabel(bisectFlags()).split(' ').filter(Boolean);
    if (page.slow) flags.push('slow');
    const report: PerfReport = {
      fps: round(run.fps),
      slowMs: round(run.ms),
      frames: this.#frames.split,
      gpu: gpu && {
        lastMs: round(gpu.lastMs),
        avgMs: round(gpu.avgMs),
        maxMs: round(gpu.maxMs),
        pending: gpu.pending,
        passed: gpu.passed,
      },
      governor: {
        tier: snapshot.tier,
        pinned: snapshot.pinned,
        renderScale: snapshot.renderScale,
        pixelRatio: round(snapshot.pixelRatio),
        decisions: [...page.decisions.entries],
      },
      // Not from a stage that went away while the chunk loaded.
      badge:
        page.badge && stage && !this.#disposed ? page.badge.read(stage).map(cleanBadgeLine) : [],
      badgeCountingMs: round(Math.min(page.badge?.countingMs ?? 0, PERF_MAX_MS)),
      sincePageLoadMs: round(Math.min(now, PERF_MAX_MS)),
      sinceSceneOpenMs: round(Math.min(now - this.#openedAt, PERF_MAX_MS)),
      visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
      flags,
      renderer: this.#kind,
    };
    const fired = { at: now, fps: report.fps, gpuMs: gpu?.avgMs ?? null };
    page.status = { ...fired, result: 'sending' };
    await apiCall('/perf/report', { method: 'POST', body: report, schema: null }).then(
      () => {
        page.status = { ...fired, result: 'sent' };
      },
      (err: unknown) => {
        const loggedOut = err instanceof ApiRequestError && err.code === 'UNAUTHENTICATED';
        page.status = { ...fired, result: loggedOut ? 'logged out' : 'failed' };
      },
    );
  }
}
