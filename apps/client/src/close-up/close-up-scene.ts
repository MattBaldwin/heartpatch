import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Layer } from '@babylonjs/core/Layers/layer';
import '@babylonjs/core/Layers/layerSceneComponent';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { VisualRegistry } from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import type { SquishMove, SquishyDetail } from '../procedural/config.js';
import type { SquishySpecies } from '../procedural/params.js';
import {
  SquishyField,
  type SquishyFieldStats,
  type SquishyHandle,
} from '../procedural/squishy-field.js';
import { CAMERA_FOV, CAMERA_POSES, STAGE, type ClosePose } from './close-up-config.js';
import {
  cameraFor,
  REST_POSE,
  screenEllipse,
  type CameraPlacement,
  type IdlePose,
  type ScreenView,
} from './close-up-view.js';
import type { ScreenTarget } from './gestures.js';

// The close-up scene (#20, design doc §20): one squishy in high detail,
// face to face, in front of a blurred snapshot of where the player came from
// (cheap depth of field, see backdrop.ts). The screen drives the camera pose
// and the squishy's idle and reaction moves; this draws them.

export interface CloseUpSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyDetail;
  readonly species: SquishySpecies;
  readonly instanceId: string;
  /** The blurred snapshot to draw behind (null: plain pink). */
  readonly backdrop: HTMLCanvasElement | null;
  /** Idle breathing; off for reduced motion, so a still view draws nothing. */
  readonly breathing: boolean;
  /** The soft contact shadow under it. Default on. */
  readonly shadows?: boolean;
}

/** Read-only numbers for the dev hook (Playwright asserts on these, not pixels). */
export interface CloseUpSceneStats extends SquishyFieldStats<SquishyDetail> {
  readonly backdrop: boolean;
}

export class CloseUpScene {
  readonly content: SceneContent;
  readonly #field: SquishyField<SquishyDetail>;
  readonly #handle: SquishyHandle;
  readonly #layer: Layer | null;
  readonly #height: number;
  readonly #width: number;
  readonly #lookAt = new Vector3();
  #camera: CameraPlacement;
  #drawn = false;
  #pose: IdlePose = REST_POSE;

  constructor(scene: Scene, options: CloseUpSceneOptions) {
    const clear = Color3.FromHexString(STAGE.clear);
    scene.clearColor = new Color4(clear.r, clear.g, clear.b, 1);
    this.#layer = options.backdrop ? backdropLayer(scene, options.backdrop) : null;

    this.#field = new SquishyField<SquishyDetail>(scene, {
      registry: options.registry,
      lod: options.lod,
      breathing: options.breathing,
      shadows: options.shadows ?? true,
    });
    this.#handle = this.#field.add(options.species, options.instanceId, {
      x: 0,
      z: 0,
      scale: STAGE.scale,
    });
    const { params } = this.#handle;
    const body = options.registry.bodies.get(params.body.id);
    this.#height = params.height * STAGE.scale;
    this.#width = (body?.width ?? 1) * params.body.scale[0] * STAGE.scale;
    this.#camera = cameraFor(CAMERA_POSES.face, this.#height);

    // The stage's camera is the map camera with no input reaching it (the
    // close-up's gesture layer sits over the canvas), so its pose stays
    // wherever this puts it, just before each render (camera matrices are
    // worked out after `onBeforeRender`).
    scene.onBeforeRenderObservable.add(() => {
      const camera = scene.activeCamera;
      if (!(camera instanceof TargetCamera)) return;
      const { position, target } = this.#camera;
      camera.fov = CAMERA_FOV;
      camera.minZ = 0.1;
      camera.position.set(position.x, position.y, position.z);
      camera.setTarget(this.#lookAt.set(target.x, target.y, target.z));
    });

    // The swoop waits for the first real frame (shaders compile first).
    scene.onAfterRenderObservable.add(() => {
      if (!this.#drawn && scene.isReady()) this.#drawn = true;
    });

    this.content = {
      bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
      start: { x: 0, z: 0 },
    };
  }

  /** World height of the squishy as drawn. */
  get height(): number {
    return this.#height;
  }

  /** True once a frame with the squishy in it has been drawn. */
  get drawn(): boolean {
    return this.#drawn;
  }

  /** Puts the camera at a pose around the squishy (`drop`: see `cameraFor`). */
  setCamera(pose: ClosePose, drop = 0): void {
    this.#camera = cameraFor(pose, this.#height, drop);
  }

  /** Poses the squishy for an idle move (a turn, a puff, a hop); `REST_POSE` puts it back. */
  setPose(pose: IdlePose): void {
    const p = this.#pose;
    if (p.yaw === pose.yaw && p.scale === pose.scale && p.lift === pose.lift) return;
    this.#pose = pose;
    this.#field.move(this.#handle, {
      x: 0,
      z: 0,
      y: pose.lift * this.#height,
      yaw: pose.yaw,
      scale: STAGE.scale * pose.scale,
    });
  }

  /** Plays a squish move (`now`: wall-clock ms). */
  play(move: SquishMove, now: number, strength = 1): void {
    this.#field.play(this.#handle, move, now, strength);
  }

  /** Advances the squishy clock; true while anything moves (breathing included). */
  update(now: number): boolean {
    return this.#field.update(now);
  }

  /** True while a squish move plays (not just breathing). */
  isPlaying(now: number): boolean {
    return this.#field.isPlaying(this.#handle, now);
  }

  setLod(lod: SquishyDetail): void {
    this.#field.setLod(lod);
  }

  /** The squishy on screen (CSS pixels), for gestures; at rest, ignoring idle moves. */
  target(view: ScreenView): ScreenTarget | null {
    return screenEllipse(this.#camera, view, { width: this.#width, height: this.#height });
  }

  get stats(): CloseUpSceneStats {
    return { ...this.#field.stats, backdrop: this.#layer !== null };
  }
}

/** The blurred snapshot as a background layer: one full-screen quad, bilinear-filtered. */
function backdropLayer(scene: Scene, image: HTMLCanvasElement): Layer {
  const texture = new DynamicTexture(
    'close-up-backdrop',
    image,
    scene,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update(true);
  const layer = new Layer('close-up-backdrop', null, scene, true);
  layer.texture = texture;
  return layer;
}
