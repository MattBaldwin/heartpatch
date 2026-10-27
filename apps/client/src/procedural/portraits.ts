import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateScreenshotUsingRenderTarget } from '@babylonjs/core/Misc/screenshotTools';
import { Scene } from '@babylonjs/core/scene';
import {
  KEEPER_DATA,
  type KeeperConfig,
  type Species,
  type VisualRegistry,
} from '@heartpatch/shared';
import { cameraFor } from '../close-up/close-up-view.js';
import { bisectFlags } from '../engine/bisect-flags.js';
import { MAX_DPR } from '../engine/dpr.js';
import { setupLighting } from '../engine/lighting/lighting.js';
import { accessoryItem } from './accessory.js';
import { BuildingField } from './buildings/building-field.js';
import type { SquishyDetail } from './config.js';
import { KeeperField } from './keeper/keeper-field.js';
import { keeperItems } from './keeper/keeper-items.js';
import { keeperHash, keeperParams } from './keeper/keeper-params.js';
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
/** A Keeper's pose: face to face, a touch above, leaning back so the face reads under a hat or hair. */
const KEEPER_POSE = { pitch: 0.18, yaw: -0.2, lookAt: 0.55, lean: 0.18 }; // TUNE
/** Camera distance per unit of the Keeper's height. */
const KEEPER_FIT = 2.5; // TUNE: room for hair, hats and wings; the crop trims the rest
/** A building's pose (#621 W1-10c): from above and to one side, as the map's camera sees it. */
const BUILDING_POSE = { pitch: 0.62, yaw: -0.5 }; // TUNE
/** Room around a building's bounding sphere, so no edge of it touches the frame. */
const BUILDING_ROOM = 1.08; // TUNE: the crop trims the rest

export interface PortraitLook {
  readonly species: Species;
  /** The instance id: two squishies of one kind differ a little, as on the map. */
  readonly instanceId: string;
  readonly accessory: string | null;
  /** The picture's side in CSS px, where a screen wants it bigger than a roster row (#515). */
  readonly size?: number;
}

/** A Keeper, dressed in what they wear (#515: the trick-or-treat door and its prize card). */
export interface KeeperPortraitLook {
  readonly config: KeeperConfig;
  /** Clothing ids, as the Wardrobe stores them (squishy accessories are skipped). */
  readonly wearing: readonly string[];
  /** The picture's side in CSS px. */
  readonly size: number;
}

/** One of my buildings at its level (#621 W1-10c: the works tile card). */
export interface BuildingPortraitLook {
  readonly buildingId: string;
  readonly level: number;
  /** Napping: drawn in its asleep look, as on the map. */
  readonly asleep: boolean;
  /** The picture's side in CSS px. */
  readonly size: number;
}

type V3 = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Where the camera sits to see a whole building from `pose` (#621 W1-10c):
 * aimed at the middle of its box, back far enough that the box's bounding
 * sphere fits inside the field of view `fov` (vertical, on a square shot)
 * with `room` to spare, whichever way it's turned. So a long Seawall or a
 * Fishing Pier's flat water never runs off the picture's edge.
 */
export function buildingCamera(
  bounds: { readonly min: V3; readonly max: V3 },
  pose: { readonly pitch: number; readonly yaw: number },
  fov: number,
  room = BUILDING_ROOM,
): { position: V3; target: V3 } {
  const { min, max } = bounds;
  const target = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2;
  const distance = (Math.max(radius, 0.01) / Math.sin(fov / 2)) * room;
  const flat = Math.cos(pose.pitch) * distance;
  return {
    target,
    position: {
      x: target.x + Math.sin(pose.yaw) * flat,
      y: target.y + Math.sin(pose.pitch) * distance,
      z: target.z - Math.cos(pose.yaw) * flat,
    },
  };
}

/** A building picture's cache key: one draw per building, level, look and size. */
export function buildingPortraitKey(look: BuildingPortraitLook): string {
  return `building|${look.buildingId}|${String(look.level)}|${look.asleep ? 'asleep' : 'awake'}|${String(look.size)}`;
}

export interface Portraits {
  /** The picture's URL when it's ready (cached), or null with no engine. */
  get(look: PortraitLook): Promise<string | null>;
}

/** Keeper pictures (#515), on the same renderer, queue and cache. */
export interface KeeperPortraits {
  /** A Keeper's picture (cached by look), or null with no engine. */
  keeper(look: KeeperPortraitLook): Promise<string | null>;
}

/** Building pictures (#621 W1-10c), on the same renderer, queue and cache. */
export interface BuildingPortraits {
  /** A building's picture (cached by look), or null with no engine. */
  building(look: BuildingPortraitLook): Promise<string | null>;
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

/**
 * Portrait snapshots since the page opened (#501): each renders the game's
 * engine into a 4× MSAA texture and reads it back. Read by the `?fps=1` badge.
 */
export const portraitSnapshots = { count: 0 };

/** A draw that hasn't finished by then is given up (it resolves to null). */
const DRAW_TIMEOUT_MS = 8_000; // TUNE
/**
 * How long a snapshot waits for its scene to be ready before it fails (it
 * always ends, so the next one can start: Babylon can't take two at once).
 */
const SNAPSHOT_TIMEOUT_MS = 20_000; // TUNE
/**
 * How long a draw waits for its scene to be ready before the snapshot: Babylon's
 * own wait never ends if it never is (nor once the scene is disposed).
 */
const READY_TIMEOUT_MS = 8_000; // TUNE
/**
 * The next draw starts after the last one ends, or after this at most: longer
 * than a draw normally takes (its ready wait, then its snapshot). A snapshot
 * still going after it is caught by `draw`'s own check (`skipFrameRender`).
 */
const QUEUE_CAP_MS = READY_TIMEOUT_MS + SNAPSHOT_TIMEOUT_MS + 5_000; // TUNE

/**
 * A snapshot of what `camera` sees, `size` px square, that always settles.
 * Babylon sizes the engine's render to the snapshot until the snapshot
 * renders, so only one may be taken at a time (`createPortraits` queues them).
 */
function snapshot(engine: AbstractEngine, camera: TargetCamera, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    CreateScreenshotUsingRenderTarget(
      engine,
      camera,
      size,
      resolve,
      'image/png',
      // 4× MSAA smooths the edges. No FXAA pass: Babylon only renders once
      // that effect compiles, holding the engine's frames until then, so one
      // that never compiled would freeze the map.
      4,
      false,
      undefined,
      false,
      false,
      true,
      undefined,
      undefined,
      undefined,
      SNAPSHOT_TIMEOUT_MS,
      () => {
        reject(new Error('portrait snapshot timed out'));
      },
    );
  });
}

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

export function createPortraits(
  options: PortraitOptions,
): Portraits & KeeperPortraits & BuildingPortraits {
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

  /** The Keepers' own small scene (#515), made the first time one is asked for. */
  let keeperStage: {
    engine: AbstractEngine;
    scene: Scene;
    field: KeeperField;
    camera: TargetCamera;
    use: InUse;
  } | null = null;

  /** The buildings' own small scene (#621 W1-10c), made the first time one is asked for. */
  let buildingStage: {
    engine: AbstractEngine;
    scene: Scene;
    field: BuildingField;
    camera: TargetCamera;
    use: InUse;
  } | null = null;

  /** No new draws on the current scene: it goes once its draws are done. */
  function retireStage(): void {
    stage?.use.retire();
    stage = null;
  }

  function retireKeeperStage(): void {
    keeperStage?.use.retire();
    keeperStage = null;
  }

  function retireBuildingStage(): void {
    buildingStage?.use.retire();
    buildingStage = null;
  }

  function buildingStageFor(engine: AbstractEngine): NonNullable<typeof buildingStage> {
    if (
      buildingStage?.engine === engine &&
      !buildingStage.use.retired &&
      !buildingStage.scene.isDisposed
    ) {
      return buildingStage;
    }
    retireBuildingStage();
    const scene = new Scene(engine, { virtual: true });
    scene.clearColor = new Color4(0, 0, 0, 0);
    setupLighting(scene);
    const field = new BuildingField(scene);
    const camera = new TargetCamera('building-portrait-camera', Vector3.Zero(), scene);
    camera.fov = FOV;
    camera.minZ = 0.1;
    scene.activeCamera = camera;
    buildingStage = {
      engine,
      scene,
      field,
      camera,
      use: inUse(() => {
        field.dispose();
        scene.dispose();
      }),
    };
    return buildingStage;
  }

  function keeperStageFor(engine: AbstractEngine): NonNullable<typeof keeperStage> {
    if (
      keeperStage?.engine === engine &&
      !keeperStage.use.retired &&
      !keeperStage.scene.isDisposed
    ) {
      return keeperStage;
    }
    retireKeeperStage();
    const scene = new Scene(engine, { virtual: true });
    scene.clearColor = new Color4(0, 0, 0, 0);
    setupLighting(scene);
    // Keepers stay on the two shared levels: a `hero` squishy detail draws them high.
    const lod = options.lod() === 'low' ? 'low' : 'high';
    const field = new KeeperField(scene, { data: KEEPER_DATA, lod, shadows: false });
    const camera = new TargetCamera('keeper-portrait-camera', Vector3.Zero(), scene);
    camera.fov = FOV;
    camera.minZ = 0.1;
    scene.activeCamera = camera;
    keeperStage = {
      engine,
      scene,
      field,
      camera,
      use: inUse(() => {
        scene.dispose();
      }),
    };
    return keeperStage;
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
    // `?noportraits=1` (#501 bisect): no snapshot, as with no engine (the sheets show their placeholder).
    if (!engine || engine.isDisposed || bisectFlags().noPortraits) return null;
    const { scene, field, camera, use } = stageFor(engine);
    const handle = field.add(look.species, look.instanceId, { x: 0, z: 0 });
    // Nothing between `stageFor` and here waits, so its scene can't be retired first.
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
      // Not ready in time: no picture this time, and no snapshot taken.
      if (
        !(await withTimeout(
          scene.whenReadyAsync().then(() => true),
          READY_TIMEOUT_MS,
        ))
      ) {
        return null;
      }
      const css = look.size ?? (window.innerWidth >= 700 ? PORTRAIT_CSS_PX : PHONE_CSS_PX);
      // The game's own pixel-ratio cap (CLAUDE.md rule 8): at 2× and up to
      // the crop's scale it stays crisp on a 3× iPhone.
      const px = Math.round(css * MAX_DPR);
      // Drawn bigger with room to spare, then cut to the squishy's own
      // outline, so long ears and tall toppers fit as well as round bodies.
      // Another snapshot is still going (one the queue gave up waiting on):
      // Babylon sets this until it renders, and two at once would leave the
      // engine's render size wrong. No picture this time.
      if (engine.skipFrameRender) return null;
      portraitSnapshots.count++;
      const shot = await snapshot(engine, camera, Math.round(px * DRAW_SCALE));
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

  async function drawKeeper(look: KeeperPortraitLook): Promise<string | null> {
    const engine = options.engine();
    if (!engine || engine.isDisposed || bisectFlags().noPortraits) return null;
    const { scene, field, camera, use } = keeperStageFor(engine);
    const handle = field.add(
      look.config,
      { x: 0, z: 0, lean: KEEPER_POSE.lean },
      keeperItems(look.wearing),
    );
    const done = use.begin();
    try {
      const height = handle.params.height;
      const { position, target } = cameraFor(
        { ...KEEPER_POSE, distance: KEEPER_FIT * height },
        height,
      );
      camera.position.set(position.x, position.y, position.z);
      camera.setTarget(new Vector3(target.x, target.y, target.z));
      field.flush();
      if (
        !(await withTimeout(
          scene.whenReadyAsync().then(() => true),
          READY_TIMEOUT_MS,
        ))
      ) {
        return null;
      }
      const px = Math.round(look.size * MAX_DPR);
      if (engine.skipFrameRender) return null;
      portraitSnapshots.count++;
      const shot = await snapshot(engine, camera, Math.round(px * DRAW_SCALE));
      return await cropToSquishy(shot, px);
    } catch {
      return null;
    } finally {
      field.remove(handle);
      options.invalidate();
      done();
    }
  }

  async function drawBuilding(look: BuildingPortraitLook): Promise<string | null> {
    const engine = options.engine();
    if (!engine || engine.isDisposed || bisectFlags().noPortraits) return null;
    const { scene, field, camera, use } = buildingStageFor(engine);
    const placement = {
      buildingId: look.buildingId,
      level: look.level,
      lit: null,
      asleep: look.asleep,
      x: 0,
      z: 0,
    };
    field.set([placement]);
    const done = use.begin();
    try {
      const bounds = field.modelBounds(placement);
      if (!bounds) return null;
      const { position, target } = buildingCamera(bounds, BUILDING_POSE, FOV);
      camera.position.set(position.x, position.y, position.z);
      camera.setTarget(new Vector3(target.x, target.y, target.z));
      if (
        !(await withTimeout(
          scene.whenReadyAsync().then(() => true),
          READY_TIMEOUT_MS,
        ))
      ) {
        return null;
      }
      const px = Math.round(look.size * MAX_DPR);
      if (engine.skipFrameRender) return null;
      portraitSnapshots.count++;
      const shot = await snapshot(engine, camera, Math.round(px * DRAW_SCALE));
      return await cropToSquishy(shot, px);
    } catch {
      return null;
    } finally {
      field.set([]);
      options.invalidate();
      done();
    }
  }

  /** Runs `work` after the last picture, so one snapshot is on the engine at a time. */
  function enqueue(work: () => Promise<string | null>): {
    entry: Promise<string | null>;
  } {
    const run = queue.then(() => {
      const started = work();
      return { started, shown: withTimeout(started, DRAW_TIMEOUT_MS) };
    });
    const entry = run.then((r) => r.shown);
    queue = run.then((r) => withTimeout(r.started, QUEUE_CAP_MS)).catch(() => null);
    return { entry };
  }

  return {
    building(look) {
      const key = buildingPortraitKey(look);
      let entry = cache.get(key);
      if (!entry) {
        entry = enqueue(() => drawBuilding(look)).entry;
        cache.set(key, entry);
        // No picture: forget it so the next look tries again, on a fresh scene.
        const mine = entry;
        void entry.then((url) => {
          if (url !== null) return;
          if (cache.get(key) === mine) cache.delete(key);
          retireBuildingStage();
        });
      }
      return entry;
    },
    keeper(look) {
      const key = `keeper|${keeperHash(keeperParams(look.config, KEEPER_DATA, keeperItems(look.wearing)))}|${String(look.size)}`;
      let entry = cache.get(key);
      if (!entry) {
        entry = enqueue(() => drawKeeper(look)).entry;
        cache.set(key, entry);
        // No picture: forget it so the next look tries again, on a fresh scene.
        const mine = entry;
        void entry.then((url) => {
          if (url !== null) return;
          if (cache.get(key) === mine) cache.delete(key);
          retireKeeperStage();
        });
      }
      return entry;
    },
    get(look) {
      const key = `${look.species.id}|${look.instanceId}|${look.accessory ?? ''}|${String(look.size ?? '')}`;
      let entry = cache.get(key);
      if (!entry) {
        // Each picture is given up on after a while (a slow device, a lost GPU
        // context), so the screen asking doesn't wait on it. The next draw
        // still waits for this one to end: two snapshots at once would leave
        // the engine's render size wrong (the map drawn in a small box).
        const run = queue.then(() => {
          const work = draw(look);
          return { work, shown: withTimeout(work, DRAW_TIMEOUT_MS) };
        });
        entry = run.then((r) => r.shown);
        queue = run.then((r) => withTimeout(r.work, QUEUE_CAP_MS)).catch(() => null);
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
