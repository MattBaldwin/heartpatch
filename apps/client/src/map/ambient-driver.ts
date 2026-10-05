import type { QualityTier } from '../engine/config.js';
import type { AmbientMode } from './ambient-layout.js';
import { AMBIENT } from './map-config.js';

// Paces the map's ambient life (the terrain visual pass). The motion itself
// is on the GPU (terrain-plugin.ts); this only moves the clock and asks for a
// frame about every 33 ms while it's live. Nothing here allocates per frame:
// the tier and reduced motion are checked on a slow timer and on the
// reduced-motion change event, not every frame.

/** What the driver drives: the open map scene (`MapScene`). */
export interface AmbientTarget {
  /** How ambient life should run; true when what's drawn changed. */
  setAmbient(tier: QualityTier, reducedMotion: boolean): boolean;
  readonly ambientMode: AmbientMode;
  /** Moves ambient time to `now` (ms); true when a frame should be drawn. */
  tick(now: number): boolean;
  /** The page was hidden: don't count the time away as a slow frame. */
  skipPace(): void;
}

export interface AmbientDriverOptions {
  /** The map scene on screen now, or null. */
  target: () => AmbientTarget | null;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  /** Draws one frame (`Stage.requestFrame`). */
  requestFrame?: () => void;
  /** The quality tier now. */
  tier?: () => QualityTier;
  /** Reduced motion (`prefers-reduced-motion`); the browser's media query by default. */
  reducedMotion?: MotionQuery | null;
}

/** The part of a `MediaQueryList` the driver reads. */
export interface MotionQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

export class AmbientDriver {
  private readonly options: AmbientDriverOptions;
  private readonly media: AmbientDriverOptions['reducedMotion'];
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = -Infinity;
  private running = false;

  constructor(options: AmbientDriverOptions) {
    this.options = options;
    this.media =
      options.reducedMotion !== undefined
        ? options.reducedMotion
        : typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : null;
    this.media?.addEventListener('change', () => {
      if (this.running) this.check();
    });
    // No frames arrive while the page is hidden: that gap isn't slowness.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.options.target()?.skipPace();
      });
    }
  }

  /** What a new scene should start with, so nothing shows that it would hide a frame later. */
  get state(): { tier: QualityTier; reducedMotion: boolean } {
    return { tier: this.tier(), reducedMotion: this.media?.matches ?? false };
  }

  /** A map scene is on screen: follow it. */
  start(): void {
    this.running = true;
    this.timer ??= setInterval(() => {
      this.check();
    }, AMBIENT.checkMs);
    this.check();
  }

  /** No map scene on screen: stop asking for frames. */
  stop(): void {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Pushes the tier and reduced motion into the scene; runs the frame loop while live. */
  private check(): void {
    const target = this.options.target();
    if (!target) return;
    if (target.setAmbient(this.tier(), this.media?.matches ?? false)) this.options.invalidate();
    if (target.ambientMode === 'live' && this.frame === 0) {
      this.frame = requestAnimationFrame(this.onFrame);
    }
  }

  private tier(): QualityTier {
    return this.options.tier?.() ?? 'high';
  }

  private readonly onFrame = (now: number): void => {
    this.frame = 0;
    const target = this.options.target();
    if (!this.running || !target || target.ambientMode !== 'live') return;
    if (now - this.last >= AMBIENT.frameMs && target.tick(now)) {
      this.last = now;
      this.options.requestFrame?.();
    }
    this.frame = requestAnimationFrame(this.onFrame);
  };
}
