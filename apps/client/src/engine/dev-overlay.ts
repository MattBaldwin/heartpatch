import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import { batchUploads } from '../procedural/batch-uploads.js';
import { countGl, type GlCounts } from './gl-counters.js';
import { activeTriangles, formatRenderStats, formatResourceStats } from './render-stats.js';
import type { RendererKind } from './renderer.js';
import type { Stage } from './stage.js';

const RENDERER_LABEL: Record<RendererKind, string> = {
  webgpu: 'WebGPU',
  webgl2: 'WebGL2',
  webgl1: 'WebGL1',
};

/**
 * Dev-only stats badge: frame rate, renderer, quality tier, the render pixel
 * ratio the dynamic scaler has picked, and the last frame's draw calls and
 * triangles (#318, for checking a real older iPad). Imported dynamically
 * from main.ts in a dev build, or on the live site with `?fps=1` (#335,
 * `showsStats`), so nobody sees it unless they ask.
 *
 * A second line counts what the scene holds and the WebGL objects made and
 * freed since the badge first saw this engine (a lost context's rebuild
 * starts again from zero) (#501: a frame rate that sinks as a session goes on
 * shows here as a number that keeps climbing), the squishy batch uploads,
 * and the governor's render scale.
 */
export function mountDevOverlay(getStage: () => Stage | null): void {
  const badge = document.createElement('div');
  badge.className = 'dev-status dev-stats';
  badge.dataset['testid'] = 'dev-stats';
  badge.textContent = 'renderer: …';
  const counts = document.createElement('div');
  counts.className = 'dev-status dev-stats-counts';
  counts.dataset['testid'] = 'dev-stats-counts';
  document.body.append(badge, counts);

  // One counter per scene: a renderer fallback or a remount makes a new one.
  let counted: { scene: Scene; instrumentation: SceneInstrumentation } | null = null;
  // The context's own calls, counted once per engine (a fallback makes a new one).
  let gl: { engine: object; counts: GlCounts | null } | null = null;
  setInterval(() => {
    const stage = getStage();
    if (!stage) return;
    if (counted?.scene !== stage.scene) {
      counted?.instrumentation.dispose();
      counted = { scene: stage.scene, instrumentation: new SceneInstrumentation(stage.scene) };
    }
    const drawCalls = counted.instrumentation.drawCallsCounter.current;
    // Idle means nothing is drawn (render on demand), so there's no frame rate.
    const rate = stage.idle ? 'idle' : `${Math.round(stage.renderer.engine.getFps())} fps`;
    const { tier, pinned, pixelRatio } = stage.quality.snapshot;
    const renderer = RENDERER_LABEL[stage.renderer.kind];
    const work = formatRenderStats(drawCalls, activeTriangles(stage.scene));
    badge.textContent = `${rate} · ${renderer} · ${tier}${pinned ? ' (pinned)' : ''} · ${pixelRatio.toFixed(2)}x · ${work}`;
    const { engine } = stage.renderer;
    if (gl?.engine !== engine) {
      // `_gl` is Babylon-internal but typed (WebGL's Engine); WebGPU has no context to count.
      gl = { engine, counts: engine instanceof Engine ? countGl(engine._gl) : null };
    }
    const { scene } = stage;
    counts.textContent = formatResourceStats({
      meshes: scene.meshes.length,
      materials: scene.materials.length,
      textures: scene.textures.length,
      animatables: scene.animatables.length,
      gl: gl.counts,
      batchUploads: batchUploads.count,
      renderScale: stage.quality.snapshot.renderScale,
    });
  }, 500);
}
