import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateScreenshotUsingRenderTargetAsync } from '@babylonjs/core/Misc/screenshotTools';
import { Scene } from '@babylonjs/core/scene';
import type { Species, VisualRegistry } from '@heartpatch/shared';
import { cameraFor } from '../../close-up/close-up-view.js';
import { setupLighting } from '../../engine/lighting/lighting.js';
import { accessoryItem } from '../../procedural/accessory.js';
import type { SquishyDetail } from '../../procedural/config.js';
import { SquishyField } from '../../procedural/squishy-field.js';

// Squishy portraits for DOM lists (#375): the real 3D squishy, drawn once on
// the game's own engine into a transparent picture and kept by look, so a
// roster of 30 costs a handful of renders, then none (idle costs nothing,
// CLAUDE.md rule 4). Without an engine (a renderer that couldn't start) the
// list keeps its plain blobs.

/** A portrait's side in CSS px; drawn at the screen's pixel ratio (capped at 3). */
export const PORTRAIT_CSS_PX = 64; // TUNE: the roster row's picture
/** The pose: face to face, a little above, turned a touch so it reads as round. */
const POSE = { pitch: 0.22, yaw: -0.35, lookAt: 0.55 }; // TUNE
/** Camera distance per unit of the squishy's larger side, so every kind fills the frame. */
const FIT = 2.3; // TUNE: room for ears and toppers
const FOV = 0.62; // TUNE: radians

export interface PortraitLook {
  readonly species: Species;
  /** The instance id: two squishies of one kind differ a little, as on the map. */
  readonly instanceId: string;
  readonly accessory: string | null;
}

export interface Portraits {
  /** The picture's URL when it's ready (cached), or null with no engine. */
  get(look: PortraitLook): Promise<string | null>;
}

export interface PortraitOptions {
  /** The game's engine, or null before it starts (or when it couldn't). */
  readonly engine: () => AbstractEngine | null;
  readonly registry: VisualRegistry;
  readonly lod: () => SquishyDetail;
  /** The map's own scene must draw again after a portrait borrowed the engine. */
  readonly invalidate: () => void;
}

export function createPortraits(options: PortraitOptions): Portraits {
  const cache = new Map<string, Promise<string | null>>();
  /** One render at a time, each after the last, so the map never stalls for long. */
  let queue: Promise<unknown> = Promise.resolve();

  /** One small scene for every portrait, kept while the engine lives. */
  let stage: {
    engine: AbstractEngine;
    scene: Scene;
    field: SquishyField<SquishyDetail>;
    camera: TargetCamera;
  } | null = null;

  function stageFor(engine: AbstractEngine): NonNullable<typeof stage> {
    if (stage?.engine === engine && !stage.scene.isDisposed) return stage;
    stage?.scene.dispose();
    const scene = new Scene(engine, { virtual: true });
    scene.clearColor = new Color4(0, 0, 0, 0);
    setupLighting(scene);
    const field = new SquishyField<SquishyDetail>(scene, {
      registry: options.registry,
      lod: options.lod(),
      breathing: false,
      shadows: false,
    });
    const camera = new TargetCamera('portrait-camera', Vector3.Zero(), scene);
    camera.fov = FOV;
    camera.minZ = 0.1;
    scene.activeCamera = camera;
    stage = { engine, scene, field, camera };
    return stage;
  }

  async function draw(look: PortraitLook): Promise<string | null> {
    const engine = options.engine();
    if (!engine) return null;
    const { scene, field, camera } = stageFor(engine);
    const handle = field.add(look.species, look.instanceId, { x: 0, z: 0 });
    try {
      field.setAccessory(handle, accessoryItem(look.accessory));
      const height = field.heightOf(handle);
      const body = options.registry.bodies.get(handle.params.body.id);
      const width = (body?.width ?? 1) * handle.params.body.scale[0];
      const distance = FIT * Math.max(height, width);
      const { position, target } = cameraFor({ ...POSE, distance }, height);
      camera.position.set(position.x, position.y, position.z);
      camera.setTarget(new Vector3(target.x, target.y, target.z));
      // The field uploads its instances before a scene render; a snapshot
      // renders straight into a texture, so upload them now.
      field.flush();
      await scene.whenReadyAsync();
      const px = Math.round(PORTRAIT_CSS_PX * Math.min(3, Math.max(2, window.devicePixelRatio)));
      return await CreateScreenshotUsingRenderTargetAsync(engine, camera, px, 'image/png', 4, true);
    } catch {
      return null;
    } finally {
      field.remove(handle);
      options.invalidate();
    }
  }

  return {
    get(look) {
      const key = `${look.species.id}|${look.instanceId}|${look.accessory ?? ''}`;
      let entry = cache.get(key);
      if (!entry) {
        entry = queue.then(() => draw(look));
        queue = entry.catch(() => null);
        cache.set(key, entry);
      }
      return entry;
    },
  };
}
