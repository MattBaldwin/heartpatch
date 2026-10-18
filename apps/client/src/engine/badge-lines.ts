import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import { batchUploads } from '../procedural/batch-uploads.js';
import { bisectFlags, bisectLabel } from './bisect-flags.js';
import { countGl, type GlCounts } from './gl-counters.js';
import { readPageStats, RenderRate } from './page-stats.js';
import {
  activeTriangles,
  formatPageStats,
  formatRenderStats,
  formatResourceStats,
} from './render-stats.js';
import type { RendererKind } from './renderer.js';
import type { Stage } from './stage.js';

const RENDERER_LABEL: Record<RendererKind, string> = {
  webgpu: 'WebGPU',
  webgl2: 'WebGL2',
  webgl1: 'WebGL1',
};

/**
 * The `?fps=1` badge's three lines (see `dev-overlay.ts`), read from a stage.
 * The badge and the perf report (#501 PR A) share one reader (`badgeReader`),
 * so they show the same counts. It starts counting (a scene instrumentation,
 * the GL wrappers) the first time it's watched, so a page that never shows
 * the badge or slows down for 3 s pays nothing.
 */
export class BadgeReader {
  /** Renders across every engine, between two reads. */
  readonly #renders = new RenderRate();
  readonly #flags = bisectLabel(bisectFlags());
  /** When this reader first counted (performance.now()), or null before. */
  #since: number | null = null;
  // One counter per scene: a renderer fallback or a remount makes a new one.
  #counted: { scene: Scene; instrumentation: SceneInstrumentation } | null = null;
  // The context's own calls, counted once per engine (a fallback makes a new one).
  #gl: { engine: object; counts: GlCounts | null } | null = null;

  /** Starts counting on `stage` without reading (the report does this as a slow run begins). */
  watch(stage: Stage): void {
    this.#watch(stage);
  }

  #watch(stage: Stage): {
    instrumentation: SceneInstrumentation;
    gl: GlCounts | null;
  } {
    if (this.#since === null) {
      this.#since = performance.now();
      // Primes the renders-per-second count, so the first read has one.
      readPageStats(this.#renders, this.#flags);
    }
    if (this.#counted?.scene !== stage.scene) {
      this.#counted?.instrumentation.dispose();
      this.#counted = {
        scene: stage.scene,
        instrumentation: new SceneInstrumentation(stage.scene),
      };
      // Our JS per drawn frame (#501): with the frame rate, it tells a stall
      // in our code from one in the GPU or the browser.
      this.#counted.instrumentation.captureFrameTime = true;
    }
    const { engine } = stage.renderer;
    if (this.#gl?.engine !== engine) {
      // `_gl` is Babylon-internal but typed (WebGL's Engine); WebGPU has no context to count.
      this.#gl = { engine, counts: engine instanceof Engine ? countGl(engine._gl) : null };
    }
    return { instrumentation: this.#counted.instrumentation, gl: this.#gl.counts };
  }

  /** How long this reader has been counting, in ms (0 before the first `watch`). */
  get countingMs(): number {
    return this.#since === null ? 0 : performance.now() - this.#since;
  }

  /** The badge's three lines for `stage`, now. */
  read(stage: Stage): [string, string, string] {
    const { instrumentation, gl } = this.#watch(stage);
    const drawCalls = instrumentation.drawCallsCounter.current;
    // Idle means nothing is drawn (render on demand), so there's no frame rate.
    const rate = stage.idle ? 'idle' : `${Math.round(stage.renderer.engine.getFps())} fps`;
    const { tier, pinned, pixelRatio, renderScale } = stage.quality.snapshot;
    const renderer = RENDERER_LABEL[stage.renderer.kind];
    const work = formatRenderStats(drawCalls, activeTriangles(stage.scene));
    const { scene } = stage;
    return [
      `${rate} · ${renderer} · ${tier}${pinned ? ' (pinned)' : ''} · ${pixelRatio.toFixed(2)}x · ${work}`,
      formatResourceStats({
        jsMs: instrumentation.frameTimeCounter.lastSecAverage,
        meshes: scene.meshes.length,
        materials: scene.materials.length,
        textures: scene.textures.length,
        animatables: scene.animatables.length,
        gl,
        batchUploads: batchUploads.count,
        renderScale,
      }),
      formatPageStats(readPageStats(this.#renders, this.#flags)),
    ];
  }
}

let shared: BadgeReader | null = null;

/** The page's one reader (made on first use, after the bisect flags are set). */
export function badgeReader(): BadgeReader {
  shared ??= new BadgeReader();
  return shared;
}
