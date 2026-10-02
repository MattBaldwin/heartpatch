import { Scene } from '@babylonjs/core/scene';
import { MapCamera } from './camera/map-camera.js';
import type { Bounds } from './camera/camera-math.js';
import { CAMERA, SETTLE_FRAMES, type QualityTier } from './config.js';
import { FrameScheduler } from './frame-scheduler.js';
import { setupLighting } from './lighting/lighting.js';
import { RenderQuality } from './quality/render-quality.js';
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
  /** Draw a few frames: call after any change the scheduler can't see (e.g. store updates). */
  invalidate(): void;
  /** True while nothing is being drawn. */
  readonly idle: boolean;
  /** Frames drawn so far (dev overlay and tests). */
  readonly draws: number;
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
  // MapCamera owns all gestures. Babylon's own scene input would raycast on
  // every pointer move and warns on multi-touch, so it stays off; in-world
  // taps can call scene.pick() directly when they arrive.
  scene.detachControl();
  setupLighting(scene);
  const { bounds } = build(scene);
  const camera = new MapCamera(scene, canvas, CAMERA, bounds);
  scene.activeCamera = camera.camera;
  const quality = new RenderQuality(scene, camera.camera, tier);

  const frames = new FrameScheduler(SETTLE_FRAMES);
  const abort = new AbortController();
  const onResize = (): void => {
    quality.refreshPixelRatio(); // the DPR changes when a window moves screens
    engine.resize();
    frames.invalidate();
  };
  window.addEventListener('resize', onResize, { signal: abort.signal });

  scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset['ready'] = 'true';
  });
  canvas.dataset['renderer'] = renderer.kind;
  // Render on demand (tech spec §6): draw only while something changes.
  let loaded = false;
  engine.runRenderLoop(() => {
    // Keep drawing until every shader, texture and post-process is ready,
    // then draw a few more: the frames drawn while loading may be empty.
    if (!loaded && scene.isReady(true) && quality.ready) {
      loaded = true;
      frames.invalidate();
    }
    const busy = !loaded || camera.wantsFrame || scene.animatables.length > 0;
    const { draw, frameMs } = frames.next(performance.now(), busy);
    if (!draw) return;
    scene.render();
    if (frameMs !== null && quality.sample(frameMs)) frames.invalidate();
  });

  return {
    renderer,
    scene,
    camera,
    quality,
    invalidate: () => {
      frames.invalidate();
    },
    get idle() {
      return frames.idle;
    },
    get draws() {
      return frames.draws;
    },
    dispose() {
      abort.abort();
      engine.stopRenderLoop();
      quality.dispose();
      camera.dispose();
      scene.dispose();
    },
  };
}
