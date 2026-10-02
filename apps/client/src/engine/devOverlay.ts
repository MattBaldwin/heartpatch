import type { RendererKind } from './renderer.js';
import type { Stage } from './stage.js';

const RENDERER_LABEL: Record<RendererKind, string> = {
  webgpu: 'WebGPU',
  webgl2: 'WebGL2',
  webgl1: 'WebGL1',
};

/**
 * Dev-only stats badge: frame rate, renderer, quality tier and the render
 * pixel ratio the dynamic scaler has picked. Imported dynamically from
 * main.ts under `import.meta.env.DEV`, so it never ships.
 */
export function mountDevOverlay(getStage: () => Stage | null): void {
  const badge = document.createElement('div');
  badge.className = 'dev-status dev-stats';
  badge.dataset['testid'] = 'dev-stats';
  badge.textContent = 'renderer: …';
  document.body.append(badge);

  setInterval(() => {
    const stage = getStage();
    if (!stage) return;
    const fps = Math.round(stage.renderer.engine.getFps());
    const { tier, pixelRatio } = stage.quality.snapshot;
    const renderer = RENDERER_LABEL[stage.renderer.kind];
    badge.textContent = `${fps} fps · ${renderer} · ${tier} · ${pixelRatio.toFixed(2)}x`;
  }, 500);
}
