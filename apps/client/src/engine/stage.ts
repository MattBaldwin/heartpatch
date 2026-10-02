import { Scene } from '@babylonjs/core/scene';
import { MapCamera } from './camera/mapCamera.js';
import type { Bounds } from './camera/cameraMath.js';
import { CAMERA, type QualityTier } from './config.js';
import { setupLighting } from './lighting/lighting.js';
import { RenderQuality } from './quality/renderQuality.js';
import type { Renderer } from './renderer.js';

export interface SceneContent {
  /** Where the camera target may roam. */
  readonly bounds: Bounds;
}

/** Fills a fresh scene with content; lighting and camera are set up for it. */
export type SceneBuilder = (scene: Scene) => SceneContent;

/** Everything running on one renderer; disposed and rebuilt on fallback. */
export interface Stage {
  readonly renderer: Renderer;
  readonly scene: Scene;
  readonly camera: MapCamera;
  readonly quality: RenderQuality;
  dispose(): void;
}

export function mountStage(
  renderer: Renderer,
  canvas: HTMLCanvasElement,
  build: SceneBuilder,
  tier: QualityTier,
): Stage {
  const { engine } = renderer;
  const scene = new Scene(engine);
  setupLighting(scene);
  const { bounds } = build(scene);
  const camera = new MapCamera(scene, canvas, CAMERA, bounds);
  scene.activeCamera = camera.camera;
  const quality = new RenderQuality(scene, camera.camera, tier);

  const abort = new AbortController();
  const onResize = (): void => {
    quality.refreshPixelRatio(); // the DPR changes when a window moves screens
    engine.resize();
  };
  window.addEventListener('resize', onResize, { signal: abort.signal });

  scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset['ready'] = 'true';
  });
  canvas.dataset['renderer'] = renderer.kind;
  engine.runRenderLoop(() => {
    scene.render();
  });

  return {
    renderer,
    scene,
    camera,
    quality,
    dispose() {
      abort.abort();
      engine.stopRenderLoop();
      quality.dispose();
      camera.dispose();
      scene.dispose();
    },
  };
}
