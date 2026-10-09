import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import { activeTriangles, formatRenderStats } from './render-stats.js';
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
 * from main.ts under `import.meta.env.DEV`, so it never ships.
 */
export function mountDevOverlay(getStage: () => Stage | null): void {
  const badge = document.createElement('div');
  badge.className = 'dev-status dev-stats';
  badge.dataset['testid'] = 'dev-stats';
  badge.textContent = 'renderer: …';
  document.body.append(badge);

  // One counter per scene: a renderer fallback or a remount makes a new one.
  let counted: { scene: Scene; instrumentation: SceneInstrumentation } | null = null;
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
    const { tier, pixelRatio } = stage.quality.snapshot;
    const renderer = RENDERER_LABEL[stage.renderer.kind];
    const work = formatRenderStats(drawCalls, activeTriangles(stage.scene));
    badge.textContent = `${rate} · ${renderer} · ${tier} · ${pixelRatio.toFixed(2)}x · ${work}`;
  }, 500);
}
