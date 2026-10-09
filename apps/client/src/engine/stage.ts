import { Scene } from '@babylonjs/core/scene';
import { MapCamera } from './camera/map-camera.js';
import type { Bounds, GroundPoint } from './camera/camera-math.js';
import { CAMERA, SETTLE_FRAMES, type CameraConfig, type QualityTier } from './config.js';
import { FrameScheduler } from './frame-scheduler.js';
import { setupLighting } from './lighting/lighting.js';
import { RenderQuality } from './quality/render-quality.js';
import type { Renderer } from './renderer.js';

export interface SceneContent {
  /** Where the camera target may roam. */
  readonly bounds: Bounds;
  /** Where the camera starts looking (clamped to `bounds`); the origin by default. */
  readonly start?: GroundPoint;
  /** How far out the camera may zoom, if not `CAMERA.maxDistance` (a bigger map, #318). */
  readonly maxDistance?: number;
}

/** Fills a fresh scene with content; lighting and camera are set up for it. */
export type SceneBuilder = (scene: Scene) => SceneContent;

/** Everything running on one renderer; disposed and rebuilt on fallback. */
export interface Stage {
  readonly renderer: Renderer;
  readonly scene: Scene;
  readonly camera: MapCamera;
  readonly quality: RenderQuality;
  /**
   * Draw a few frames. The loop only draws on its own while the camera moves,
   * Babylon animations (`scene.animatables`) run, or the scene is loading.
   * Anything else that changes the picture must call this: store updates,
   * meshes or textures added after load, `onBeforeRender` animation, particle
   * systems, dynamic or video textures. Continuous effects should call it
   * every frame while they run.
   */
  invalidate(): void;
  /** Draw one more frame, without settle frames (see `FrameScheduler.requestFrame`). */
  requestFrame(): void;
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
  /** Dev galleries only: a different camera (pitch, distance) than the game's. */
  camera: Partial<CameraConfig> = {},
): Stage {
  const { engine } = renderer;
  const scene = new Scene(engine);
  // MapCamera owns all gestures. Babylon's own scene input would raycast on
  // every pointer move and warns on multi-touch, so it stays off; in-world
  // taps can call scene.pick() directly when they arrive.
  scene.detachControl();
  setupLighting(scene);
  let content: SceneContent;
  try {
    content = build(scene);
  } catch (err) {
    scene.dispose(); // don't leave a half-built scene on the engine
    throw err;
  }
  const { bounds, start, maxDistance } = content;
  const mapCamera = new MapCamera(
    scene,
    canvas,
    { ...CAMERA, ...(maxDistance !== undefined && { maxDistance }), ...camera },
    bounds,
    start,
  );
  scene.activeCamera = mapCamera.camera;
  const quality = new RenderQuality(scene, mapCamera.camera, tier);

  const frames = new FrameScheduler(SETTLE_FRAMES);
  const abort = new AbortController();
  // One resize path, run at the top of the next frame, so the resize and
  // the draw it needs share it (resizing after a draw clears the buffer
  // that frame shows). The canvas's own box is watched: iOS sends `resize`
  // before a turned layout settles and none after, so the buffer and the
  // camera's aspect kept the old shape until the map was remounted (#251).
  // Window `resize` still covers a pixel-ratio change (a window moving
  // screens) that leaves the box as it was.
  let resizePending = false;
  const onResize = (): void => {
    resizePending = true;
  };
  window.addEventListener('resize', onResize, { signal: abort.signal });
  const canvasBox = new ResizeObserver(onResize);
  canvasBox.observe(canvas);
  abort.signal.addEventListener('abort', () => {
    canvasBox.disconnect();
  });

  scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset['ready'] = 'true';
  });
  canvas.dataset['renderer'] = renderer.kind;
  // Render on demand (tech spec §6): draw only while something changes.
  let loaded = false;
  /**
   * Back to "loading": draw every frame until all shaders and post-processes
   * are ready again, then settle. Used when a quality change recompiles
   * post-process effects asynchronously, so the frame left on screen while
   * idle is never one drawn mid-compile. (A lost GPU context rebuilds the
   * whole stage instead; see boot.ts.)
   */
  const reload = (): void => {
    loaded = false;
    frames.invalidate();
  };
  /** The governor asked for a new resolution or tier after the last draw. */
  let rescalePending = false;
  engine.runRenderLoop(() => {
    // The governor's rescale, at the top of the frame like a resize: setting
    // the canvas size clears its buffer, so after a draw it would show a
    // blank frame (#260). First, so a resize in the same frame (which
    // re-applies the pixel ratio) can't take its tier change without the
    // reload a recompiled post-process needs.
    if (rescalePending) {
      rescalePending = false;
      if (quality.applyPending()) reload();
    }
    if (resizePending) {
      resizePending = false;
      quality.refreshPixelRatio();
      engine.resize();
      frames.invalidate();
    }
    // Keep drawing until every shader, texture and post-process is ready,
    // then draw a few more: the frames drawn while loading may be empty.
    if (!loaded && scene.isReady(true) && quality.ready) {
      loaded = true;
      frames.invalidate();
    }
    const busy = !loaded || mapCamera.wantsFrame || scene.animatables.length > 0;
    const { draw, frameMs } = frames.next(performance.now(), busy);
    if (!draw) return;
    scene.render();
    if (frameMs !== null && quality.sample(frameMs)) rescalePending = true;
  });

  return {
    renderer,
    scene,
    camera: mapCamera,
    quality,
    invalidate: () => {
      frames.invalidate();
    },
    requestFrame: () => {
      frames.requestFrame();
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
      mapCamera.dispose();
      scene.dispose();
    },
  };
}
