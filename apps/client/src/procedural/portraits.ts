import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateScreenshotUsingRenderTargetAsync } from '@babylonjs/core/Misc/screenshotTools';
import { Scene } from '@babylonjs/core/scene';
import type { Species, VisualRegistry } from '@heartpatch/shared';
import { cameraFor } from '../close-up/close-up-view.js';
import { MAX_DPR } from '../engine/dpr.js';
import { setupLighting } from '../engine/lighting/lighting.js';
import { accessoryItem } from './accessory.js';
import type { SquishyDetail } from './config.js';
import { SquishyField } from './squishy-field.js';

// Squishy portraits for DOM screens (#375: the Squishies roster and the care sheet): the real 3D squishy, drawn once on
// the game's own engine into a transparent picture and kept by look, so a
// roster of 30 costs a handful of renders, then none (idle costs nothing,
// CLAUDE.md rule 4). Without an engine (a renderer that couldn't start) the
// list keeps its plain blobs.

/** A portrait's side in CSS px; drawn at the screen's pixel ratio (capped at 3). */
export const PORTRAIT_CSS_PX = 112; // TUNE: the roster row's picture at its largest (iPad)
/** Phones show it smaller (the roster's 88, the care sheet's 96): drawn for that. */
const PHONE_CSS_PX = 96; // TUNE
/** How much bigger than the picture the snapshot is drawn, before the crop. */
const DRAW_SCALE = 1.5; // TUNE: room for the crop without a costly snapshot
/** The pose: face to face, a little above, turned a touch so it reads as round. */
const POSE = { pitch: 0.22, yaw: -0.35, lookAt: 0.6 }; // TUNE: a little above the middle, for ears and toppers
/** Camera distance per unit of the squishy's larger side, so every kind fills the frame. */
const FIT = 2.9; // TUNE: room for ears and toppers; `cropToSquishy` trims the rest
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

/** Space left around the squishy after the crop, as a share of the picture. */
const MARGIN = 0.06; // TUNE

/** The opaque pixels' box in RGBA data, or null when nothing was drawn. */
export function opaqueBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Cuts a square around the drawn squishy (with a small margin) and scales it to `px`. */
async function cropToSquishy(dataUrl: string, px: number): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const from = document.createElement('canvas');
  from.width = image.width;
  from.height = image.height;
  const fromCtx = from.getContext('2d');
  if (!fromCtx) return dataUrl;
  fromCtx.drawImage(image, 0, 0);
  const box = opaqueBox(
    fromCtx.getImageData(0, 0, from.width, from.height).data,
    from.width,
    from.height,
  );
  if (!box) return dataUrl;
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) / (1 - 2 * MARGIN);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const to = document.createElement('canvas');
  to.width = px;
  to.height = px;
  const toCtx = to.getContext('2d');
  if (!toCtx) return dataUrl;
  toCtx.imageSmoothingQuality = 'high';
  toCtx.drawImage(from, cx - side / 2, cy - side / 2, side, side, 0, 0, px, px);
  return to.toDataURL('image/png');
}

/** A draw that hasn't finished by then is given up (it resolves to null). */
const DRAW_TIMEOUT_MS = 8_000; // TUNE

/** `work`, or null if it hasn't settled within `ms`. */
function withTimeout<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve(null);
    }, ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Something draws keep using, disposed only once it's retired and no draw is
 * still on it: a draw given up on (`DRAW_TIMEOUT_MS`) may still have its
 * snapshot pending, and disposing the scene under it breaks the engine's
 * render loop (readPixels comes back null).
 */
export interface InUse {
  /** A draw starts on it; the returned call says it's done. */
  begin(): () => void;
  /** No new draws; it goes once the last one in progress is done. */
  retire(): void;
  readonly retired: boolean;
}

export function inUse(dispose: () => void): InUse {
  let drawing = 0;
  let retired = false;
  let gone = false;
  const settle = () => {
    if (!retired || drawing > 0 || gone) return;
    gone = true;
    dispose();
  };
  return {
    begin() {
      drawing += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        drawing -= 1;
        settle();
      };
    },
    retire() {
      retired = true;
      settle();
    },
    get retired() {
      return retired;
    },
  };
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
    use: InUse;
  } | null = null;

  /** No new draws on the current scene: it goes once its draws are done. */
  function retireStage(): void {
    stage?.use.retire();
    stage = null;
  }

  function stageFor(engine: AbstractEngine): NonNullable<typeof stage> {
    if (stage?.engine === engine && !stage.use.retired && !stage.scene.isDisposed) return stage;
    retireStage();
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
    stage = {
      engine,
      scene,
      field,
      camera,
      use: inUse(() => {
        scene.dispose();
      }),
    };
    return stage;
  }

  async function draw(look: PortraitLook): Promise<string | null> {
    const engine = options.engine();
    if (!engine || engine.isDisposed) return null;
    const { scene, field, camera, use } = stageFor(engine);
    const handle = field.add(look.species, look.instanceId, { x: 0, z: 0 });
    const done = use.begin();
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
      const css = window.innerWidth >= 700 ? PORTRAIT_CSS_PX : PHONE_CSS_PX;
      // The game's own pixel-ratio cap (CLAUDE.md rule 8): at 2× and up to
      // the crop's scale it stays crisp on a 3× iPhone.
      const px = Math.round(css * MAX_DPR);
      // Drawn bigger with room to spare, then cut to the squishy's own
      // outline, so long ears and tall toppers fit as well as round bodies.
      const shot = await CreateScreenshotUsingRenderTargetAsync(
        engine,
        camera,
        Math.round(px * DRAW_SCALE),
        'image/png',
        4,
        true,
      );
      return await cropToSquishy(shot, px);
    } catch {
      return null;
    } finally {
      field.remove(handle);
      options.invalidate();
      // Its scene goes now if it was retired meanwhile (a timeout).
      done();
    }
  }

  return {
    get(look) {
      const key = `${look.species.id}|${look.instanceId}|${look.accessory ?? ''}`;
      let entry = cache.get(key);
      if (!entry) {
        // Each draw gives up after a while (a lost GPU context never finishes
        // its snapshot), so one stuck draw can't hold up every picture after it.
        entry = queue.then(() => withTimeout(draw(look), DRAW_TIMEOUT_MS));
        queue = entry.catch(() => null);
        cache.set(key, entry);
        // No picture (no engine yet, a failure, a timeout): forget it, so the
        // next look tries again rather than keeping the blob all session.
        const mine = entry;
        void entry.then((url) => {
          if (url !== null) return;
          if (cache.get(key) === mine) cache.delete(key);
          // A draw that gave up may have left its squishy in the scene, and
          // may still be drawing: the next one starts on a fresh scene, and
          // this one goes once that draw is done.
          retireStage();
        });
      }
      return entry;
    },
  };
}
