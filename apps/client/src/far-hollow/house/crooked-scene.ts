import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import {
  CROOKED_HOUSE,
  defaultKeeperConfig,
  doorsOf,
  KEEPER_DATA,
  type CrookedHouseView,
  type CrookedRoom,
  type KeeperConfig,
} from '@heartpatch/shared';
import { FRAME_CAP_30, type QualityTier } from '../../engine/config.js';
import type { SceneContent } from '../../engine/stage.js';
import { kitMesh, merged, type Part } from '../../explore/kit-mesh.js';
import { KeeperField, type KeeperHandle } from '../../procedural/keeper/keeper-field.js';
import { keeperItems } from '../../procedural/keeper/keeper-items.js';
import { faceYaw } from '../../procedural/face-yaw.js';
import type { SquishyLod } from '../../procedural/config.js';
import {
  blk,
  doorSlab,
  joyed,
  keyShape,
  lampStand,
  lanternFrame,
  lanternGlass,
  padlock,
  prop,
  rug,
  shell,
  type WallGap,
} from './crooked-kit.js';
import {
  CROOKED_WALK,
  crookedThings,
  doorEnd,
  doorState,
  farEnd,
  floorBox,
  litRooms,
  roomOf,
  roomsOn,
  thingPoint,
  type CrookedShot,
  type FloorPoint,
} from './crooked-plan.js';
import { echoShape } from './crooked-echo-kit.js';
import type { EchoSpot } from './crooked-echoes.js';

// The Crooked House's 3D view (#306 6c): the rooms of one floor, each one
// merged vertex-coloured mesh (grey while dark, full colour once put
// right), their doors and padlocks, the lamps, the Keeper with the lantern,
// and a camera written before each render (the stage's own camera gets no
// input; the HUD's ground layer takes the touches, as explore's). Only the
// room I'm in and its neighbours are drawn, unless the dollhouse map shows
// the whole floor. Lights: the lantern and the room's lamp on low, more on
// high (tech spec §6, rule 8).

/** How many point lights each tier draws (the lantern counts). */
const LIGHTS_BY_TIER: Record<QualityTier, number> = { low: 2, medium: 3, high: 4 }; // TUNE

/** A Relight board's flare where its thing stands (#306 6f). */
const RELIT = {
  ms: 1800, // TUNE
  /** How far past its size it swells as it lights. */
  swell: 1.2, // TUNE
  /** Metres over the floor. */
  height: 0.95, // TUNE
} as const;

const BLOOM = {
  /** The bloom rolls in over this long, ms (instant with reduced motion). */
  ms: 900, // TUNE
  /** In this many steps of colour (each a cached mesh). */
  steps: 5, // TUNE
} as const;

/** The camera eases to a new shot at this rate, a share a second (a cut with reduced motion). */
const CAMERA_EASE = 6; // TUNE
/** An echo floats and bobs (still with reduced motion), and grows a little when it notices me. TUNE */
const ECHO_FLOAT = { up: 0.18, bob: 0.08, hz: 0.6, notice: 1.14, scale: 0.95 } as const;

/**
 * The Keeper in the house: smaller than on the map, so it sits right
 * beside the lamps and pots, and upright (owner playtest, #306 6d).
 */
const HOUSE_KEEPER = { scale: 0.72, lean: 0.12 } as const; // TUNE
/** The lantern swings a little ahead of the Keeper's right hand (at the Keeper's full size). */
const LANTERN_AT = { side: 0.42, up: 0.95, ahead: 0.12 } as const; // TUNE

export interface CrookedSceneOptions {
  readonly tier: QualityTier;
  readonly lod: SquishyLod;
  readonly keeper: KeeperConfig | null;
  readonly keeperWearing: readonly string[];
  readonly reducedMotion: boolean;
}

/** What the dev hook and the budget check read. */
export interface CrookedSceneStats {
  readonly rooms: readonly string[];
  readonly lights: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly bloom: string | null;
  /** The echoes drawn now (#306 6d). */
  readonly echoes: number;
}

const SCREEN_FROM = new Vector3();
const SCREEN_AT = new Vector3();
const SCREEN_VIEWPORT = new Viewport(0, 0, 1, 1);

export class CrookedScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #options: CrookedSceneOptions;
  readonly #roomMat: PBRMaterial;
  readonly #glowMat: StandardMaterial;
  readonly #keyMat: StandardMaterial;
  readonly #litFill: HemisphericLight;
  readonly #darkFill: HemisphericLight;
  readonly #lantern: PointLight;
  readonly #lamps: PointLight[] = [];
  readonly #keepers: KeeperField;
  readonly #keeper: KeeperHandle | null = null;
  readonly #lanternFrame: Mesh;
  readonly #lanternGlass: Mesh;
  readonly #key: Mesh;
  /** Each Relight board's glow over its thing, by room (#306 6f). */
  readonly #relit = new Map<string, { mesh: Mesh; at: FloorPoint; thing: string }>();
  readonly #instrumentation: SceneInstrumentation;
  readonly #echoMat: StandardMaterial;
  /** The echo meshes, by loop id (#306 6d): made as an echo first comes near. */
  readonly #echoes = new Map<string, Mesh>();
  /** The room meshes drawn now, by room id, and the state each was built for. */
  readonly #rooms = new Map<string, { mesh: Mesh; key: string; lit: boolean }>();
  #view: CrookedHouseView | null = null;
  #at: FloorPoint = { x: 0, z: 0 };
  #yaw = 0;
  #keeperShown = true;
  #shot: CrookedShot = { target: { x: 0, z: 0 }, pitch: 1, distance: 15 };
  #goal: CrookedShot = this.#shot;
  #bloom: { room: string; from: number } | null = null;
  #keyShown: { at: FloorPoint; from: number } | null = null;
  /** A board just relit: its glow swells, then settles. */
  #relitShown: { room: string; from: number } | null = null;
  #drawCalls = 0;
  #triangles = 0;
  readonly #look = new Vector3();

  constructor(scene: Scene, options: CrookedSceneOptions) {
    this.#scene = scene;
    this.#options = options;
    scene.clearColor = Color4.FromColor3(Color3.FromHexString('#0b0912').toLinearSpace(), 1);
    scene.environmentIntensity = 0.05;
    for (const light of [...scene.lights]) light.setEnabled(false);
    // The world is matte vinyl (art bible §4: no clearcoat on the world).
    const room = new PBRMaterial('crooked-room', scene);
    room.albedoColor = Color3.White();
    room.metallic = 0;
    room.roughness = 0.62;
    room.maxSimultaneousLights = LIGHTS_BY_TIER.high + 2;
    this.#roomMat = room;
    this.#glowMat = glow(scene, 'crooked-glow', '#ffc46b', 2.4);
    this.#keyMat = glow(scene, 'crooked-key', '#ffd27a', 1.6);

    this.#litFill = new HemisphericLight('crooked-lit-fill', new Vector3(0.2, 1, -0.3), scene);
    this.#litFill.diffuse = Color3.FromHexString('#fff1dc');
    this.#litFill.groundColor = Color3.FromHexString('#4a3a55');
    this.#litFill.intensity = 0.9;
    this.#darkFill = new HemisphericLight('crooked-dark-fill', new Vector3(0, 1, 0), scene);
    this.#darkFill.diffuse = Color3.FromHexString('#2a2440');
    this.#darkFill.groundColor = Color3.FromHexString('#120f1c');
    this.#darkFill.intensity = 0.3;
    this.#lantern = point(scene, 'crooked-lantern', '#ffb866', 7, 5.2);
    for (let i = 1; i < LIGHTS_BY_TIER[options.tier]; i++) {
      const lamp = point(scene, `crooked-lamp-${String(i)}`, '#ffe2b8', 14, 9);
      lamp.setEnabled(false);
      this.#lamps.push(lamp);
    }

    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    const base = KEEPER_DATA.bases[0];
    const look = options.keeper ?? (base ? defaultKeeperConfig(base) : null);
    if (look)
      this.#keeper = this.#keepers.add(look, this.#placement(), keeperItems(options.keeperWearing));
    this.#lanternFrame = kitMesh(scene, 'crooked-lantern-frame', () => merged(lanternFrame()));
    this.#lanternFrame.material = room;
    this.#lanternGlass = kitMesh(scene, 'crooked-lantern-glass', () => merged(lanternGlass()));
    this.#lanternGlass.material = this.#glowMat;
    // The lantern is the Keeper's size.
    this.#lanternFrame.scaling.setAll(HOUSE_KEEPER.scale);
    this.#lanternGlass.scaling.setAll(HOUSE_KEEPER.scale);
    this.#key = kitMesh(scene, 'crooked-key', () => merged(keyShape()));
    this.#key.material = this.#keyMat;
    this.#key.setEnabled(false);
    // The lantern's own glow, so a relit board compiles nothing new as it plays.
    for (const room of CROOKED_HOUSE.rooms) {
      for (const thing of room.things.filter((t) => t.kind === 'relight')) {
        const mesh = CreateSphere(
          `crooked-relit-${room.id}`,
          { diameter: 0.4, segments: 8 },
          scene,
        );
        mesh.material = this.#glowMat;
        mesh.isPickable = false;
        mesh.setEnabled(false);
        const at = thingPoint(room, thing);
        mesh.position.set(at.x, RELIT.height, at.z);
        this.#relit.set(room.id, { mesh, at, thing: thing.id });
      }
    }
    // The echoes glow on their own (emissive, never another light: the tier caps lights).
    this.#echoMat = glow(scene, 'crooked-echo', '#ffffff', 1);
    this.#echoMat.alpha = 0.88;

    this.#instrumentation = new SceneInstrumentation(scene);
    const before = scene.onBeforeRenderObservable.add(() => {
      this.#applyCamera();
    });
    const after = scene.onAfterRenderObservable.add(() => {
      this.#drawCalls = this.#instrumentation.drawCallsCounter.current;
      this.#triangles = Math.round(scene.getActiveIndices() / 3);
    });
    scene.onDisposeObservable.addOnce(() => {
      scene.onBeforeRenderObservable.remove(before);
      scene.onAfterRenderObservable.remove(after);
      this.#instrumentation.dispose();
    });
    const all = floorBox(0);
    this.content = {
      bounds: { minX: all.x - 30, maxX: all.x + 30, minZ: all.z - 30, maxZ: all.z + 30 },
      start: { x: all.x, z: all.z },
      maxDistance: 80,
      // Explore's cap: walking and the drifting echoes draw at most 30 a second (#306 6d).
      frameCap: FRAME_CAP_30,
    };
  }

  /**
   * Draws `rooms` (ids on one floor) for `view`: a room rebuilds only when
   * its look changes (lit, its things fixed, its doors), and the ones no
   * longer shown go.
   */
  show(view: CrookedHouseView, rooms: readonly string[]): void {
    this.#view = view;
    const lit = litRooms(view);
    const wanted = new Set(rooms);
    for (const [id, built] of this.#rooms) {
      if (wanted.has(id)) continue;
      built.mesh.dispose();
      this.#rooms.delete(id);
    }
    for (const id of rooms) {
      const room = roomOf(id);
      if (!room) continue;
      const blooming = this.#bloom?.room === id;
      const joy = blooming ? this.#bloomJoy() : lit.has(id) ? 1 : 0;
      const key = roomKey(room, view, joy);
      const had = this.#rooms.get(id);
      if (had?.key === key) continue;
      had?.mesh.dispose();
      // One-off scene geometry (not the page-lifetime kit cache): a room
      // has many looks over a season, and dispose() must free each.
      const mesh = new Mesh(`crooked-room-${key}`, this.#scene);
      merged(roomParts(room, view, joy)).data.applyToMesh(mesh);
      mesh.isPickable = false;
      mesh.material = this.#roomMat;
      mesh.position.set(room.box.x, 0, room.box.z);
      this.#rooms.set(id, { mesh, key, lit: joy >= 1 || lit.has(id) });
    }
    this.#lightRooms();
    // A relit board glows in its dark room (once the room is lit, it's in colour anyway).
    for (const [id, glow] of this.#relit) {
      const fixed = view.rooms.find((r) => r.id === id)?.fixed.includes(glow.thing) ?? false;
      glow.mesh.setEnabled(wanted.has(id) && fixed && !lit.has(id));
    }
  }

  /** Which meshes each fill lights, and the lamps of the lit rooms nearest the Keeper. */
  #lightRooms(): void {
    const lit: Mesh[] = [];
    const dark: Mesh[] = [this.#lanternFrame];
    for (const built of this.#rooms.values()) (built.lit ? lit : dark).push(built.mesh);
    this.#litFill.includedOnlyMeshes = lit;
    this.#darkFill.includedOnlyMeshes = dark;
    // The lamps: the lit rooms nearest the Keeper first.
    const lamps = [...this.#rooms.entries()]
      .filter(([, b]) => b.lit)
      .map(([id]) => roomOf(id))
      .filter((r): r is CrookedRoom => r !== null && r.lamp !== null)
      .sort((a, b) => dist2(a.box, this.#at) - dist2(b.box, this.#at));
    this.#lamps.forEach((light, i) => {
      const room = lamps[i];
      light.setEnabled(room !== undefined);
      if (room?.lamp) light.position.set(room.box.x + room.lamp[0], 2.4, room.box.z + room.lamp[1]);
    });
  }

  /** Starts a room's bloom: colour rolls in from grey (`step` draws it). */
  bloom(room: string): void {
    if (this.#options.reducedMotion) return;
    this.#bloom = { room, from: performance.now() };
  }

  #bloomJoy(): number {
    if (!this.#bloom) return 1;
    const t = Math.min(1, (performance.now() - this.#bloom.from) / BLOOM.ms);
    return Math.round(t * BLOOM.steps) / BLOOM.steps;
  }

  /** A found key floats up out of the thing it was in, glinting, for a moment. */
  showKey(at: FloorPoint): void {
    this.#keyShown = { at, from: performance.now() };
    this.#key.setEnabled(true);
  }

  /**
   * A Relight board solved (#306 6f): a warm glow swells where its thing
   * stands, then settles and stays while the room is dark (its lamps are lit
   * now). No swell under reduced motion.
   */
  relit(room: string): void {
    const glow = this.#relit.get(room);
    if (!glow || this.#options.reducedMotion) return;
    glow.mesh.scaling.setAll(0);
    this.#relitShown = { room, from: performance.now() };
  }

  hideKey(): void {
    this.#keyShown = null;
    this.#key.setEnabled(false);
  }

  /** The Keeper stands at `at`, facing `yaw`; the lantern goes with it. */
  moveKeeper(at: FloorPoint, yaw: number): void {
    this.#at = at;
    this.#yaw = yaw;
    if (this.#keeper) this.#keepers.move(this.#keeper, this.#placement());
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Yaw 0 faces −z: the Keeper's right hand is −x, ahead is −z.
    const k = HOUSE_KEEPER.scale;
    const lx = at.x - (c * LANTERN_AT.side + s * LANTERN_AT.ahead) * k;
    const lz = at.z + (s * LANTERN_AT.side - c * LANTERN_AT.ahead) * k;
    const ly = LANTERN_AT.up * k;
    this.#lanternFrame.position.set(lx, ly, lz);
    this.#lanternGlass.position.set(lx, ly, lz);
    this.#lantern.position.set(lx, ly + 0.3, lz);
  }

  /** The Keeper shows on its own floor only (the map may show another). */
  setKeeperShown(shown: boolean): void {
    if (this.#keeperShown === shown) return;
    this.#keeperShown = shown;
    if (this.#keeper) this.#keepers.move(this.#keeper, this.#placement());
    this.#lanternFrame.setEnabled(shown);
    this.#lanternGlass.setEnabled(shown);
  }

  #placement() {
    // Off the floor's edge while another floor shows: the field has no hide.
    const away = this.#keeperShown ? 0 : 1000;
    return {
      x: this.#at.x + away,
      z: this.#at.z,
      y: 0,
      yaw: this.#yaw,
      lean: HOUSE_KEEPER.lean,
      scale: HOUSE_KEEPER.scale,
    };
  }

  /** The lantern's light: brighter in the dark, softer in a lit room. */
  setLantern(dark: boolean, tiptoe: boolean): void {
    this.#lantern.intensity = dark ? (tiptoe ? 3.5 : 7) : 2.5;
    this.#lantern.range = tiptoe ? 3 : 5.2;
  }

  /** The camera goes to `shot`: eased, or a cut (`now`, or reduced motion). */
  frame(shot: CrookedShot, now: boolean): void {
    this.#goal = shot;
    if (now || this.#options.reducedMotion) this.#shot = shot;
  }

  /** Steps the camera, the bloom and the key; true while anything still moves (keep drawing). */
  step(dt: number, now: number): boolean {
    let moving = false;
    const g = this.#goal;
    const s = this.#shot;
    if (s !== g) {
      const k = 1 - Math.exp(-CAMERA_EASE * dt);
      const next: CrookedShot = {
        target: {
          x: s.target.x + (g.target.x - s.target.x) * k,
          z: s.target.z + (g.target.z - s.target.z) * k,
        },
        pitch: s.pitch + (g.pitch - s.pitch) * k,
        distance: s.distance + (g.distance - s.distance) * k,
      };
      const close =
        Math.abs(next.target.x - g.target.x) < 0.01 &&
        Math.abs(next.target.z - g.target.z) < 0.01 &&
        Math.abs(next.distance - g.distance) < 0.02 &&
        Math.abs(next.pitch - g.pitch) < 0.002;
      this.#shot = close ? g : next;
      moving = !close;
    }
    if (this.#bloom && this.#view) {
      const done = now - this.#bloom.from >= BLOOM.ms;
      this.show(this.#view, [...this.#rooms.keys()]);
      if (done) {
        this.#bloom = null;
        this.show(this.#view, [...this.#rooms.keys()]);
      } else moving = true;
    }
    if (this.#relitShown) {
      const glow = this.#relit.get(this.#relitShown.room);
      const t = (now - this.#relitShown.from) / RELIT.ms;
      if (!glow || t >= 1 || this.#options.reducedMotion) {
        this.#relitShown = null;
        glow?.mesh.scaling.setAll(1);
      } else {
        // Up from nothing, past its size, and back to it.
        glow.mesh.scaling.setAll(Math.min(1, t * 4) + Math.sin(Math.PI * t) * RELIT.swell);
        moving = true;
      }
    }
    if (this.#keyShown) {
      const t = (now - this.#keyShown.from) / 1000;
      const rise = Math.min(1, t * 1.6);
      this.#key.position.set(
        this.#keyShown.at.x,
        1.0 + rise * 0.9 + Math.sin(t * 3) * 0.06,
        this.#keyShown.at.z,
      );
      this.#key.rotation.y = t * 1.4;
      this.#key.scaling.setAll(1.6);
      moving = true;
    }
    if (this.#keeper) moving = this.#keepers.update(now) || moving;
    return moving;
  }

  // ── The echoes (#306 6d) ────────────────────────────────────────────

  /**
   * Draws the echoes in the rooms shown now, where `spots` says they drift
   * (fading as one drifts into the light), the one `watching` turned to me
   * and a little bigger; one `under` the HUD isn't drawn (its eyes peek in
   * below it instead). `near`: an echo could show in the rooms drawn
   * (check again soon); `shown`: one is on screen now (keep drawing).
   */
  setEchoes(
    spots: readonly EchoSpot[],
    watching: string | null,
    now: number,
    under: ReadonlySet<string> = new Set(),
  ): { near: boolean; shown: boolean } {
    let near = false;
    let shown = false;
    for (const spot of spots) {
      const there =
        !spot.gone &&
        this.#onShownFloor(spot) &&
        (this.#rooms.has(spot.between[0]) || this.#rooms.has(spot.between[1]));
      let mesh = this.#echoes.get(spot.loop);
      if (!there) {
        mesh?.setEnabled(false);
        continue;
      }
      near = true;
      if (!mesh) {
        mesh = kitMesh(this.#scene, 'crooked-echo', echoShape);
        mesh.material = this.#echoMat;
        this.#echoes.set(spot.loop, mesh);
      }
      const drawn = spot.shown > 0.02 && !under.has(spot.loop);
      mesh.setEnabled(drawn);
      if (drawn) shown = true;
      mesh.visibility = spot.shown;
      const t = now / 1000;
      const bob = this.#options.reducedMotion
        ? 0
        : Math.sin(t * Math.PI * 2 * ECHO_FLOAT.hz) * ECHO_FLOAT.bob;
      mesh.position.set(spot.at.x, ECHO_FLOAT.up + bob, spot.at.z);
      const noticed = watching === spot.loop;
      mesh.rotation.y = noticed
        ? faceYaw(this.#at.x - spot.at.x, this.#at.z - spot.at.z)
        : spot.heading;
      mesh.scaling.setAll(ECHO_FLOAT.scale * (noticed ? ECHO_FLOAT.notice : 1));
    }
    return { near, shown };
  }

  /** An echo shows on the floor drawn now. */
  #onShownFloor(spot: EchoSpot): boolean {
    const any = this.#rooms.keys().next();
    return any.done !== true && roomOf(any.value)?.floor === spot.floor;
  }

  #applyCamera(): void {
    const camera = this.#scene.activeCamera;
    if (!(camera instanceof TargetCamera)) return;
    const { target, pitch, distance } = this.#shot;
    camera.position.set(
      target.x,
      Math.sin(pitch) * distance,
      target.z - Math.cos(pitch) * distance,
    );
    camera.setTarget(this.#look.set(target.x, 0, target.z));
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
  }

  /** The camera's vertical field of view (the fit needs it). */
  get fov(): number {
    return this.#scene.activeCamera?.fov ?? 0.8;
  }

  /** Where a floor point (at `lift` metres up) is on screen, CSS pixels from the page's top left. */
  screenOf(p: FloorPoint, lift = 0): { x: number; y: number } | null {
    const camera = this.#scene.activeCamera;
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    if (!camera || !canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    this.#applyCamera();
    camera.viewport.toGlobalToRef(box.width, box.height, SCREEN_VIEWPORT);
    const s = Vector3.ProjectToRef(
      SCREEN_FROM.set(p.x, lift, p.z),
      Matrix.IdentityReadOnly,
      camera.getTransformationMatrix(),
      SCREEN_VIEWPORT,
      SCREEN_AT,
    );
    if (s.z < 0 || s.z > 1) return null;
    return { x: box.left + s.x, y: box.top + s.y };
  }

  /** The floor point under a screen point (CSS pixels from the canvas's top left), or null. */
  floorAt(x: number, y: number): FloorPoint | null {
    const camera = this.#scene.activeCamera;
    const engine = this.#scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!camera || !canvas) return null;
    this.#applyCamera();
    // Picking works in render pixels.
    const k = engine.getRenderWidth() / Math.max(1, canvas.getBoundingClientRect().width);
    const ray = CreatePickingRay(this.#scene, x * k, y * k, null, camera);
    if (ray.direction.y >= 0) return null;
    const t = -ray.origin.y / ray.direction.y;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  get stats(): CrookedSceneStats {
    return {
      rooms: [...this.#rooms.keys()],
      lights: 1 + this.#lamps.filter((l) => l.isEnabled()).length,
      drawCalls: this.#drawCalls,
      triangles: this.#triangles,
      bloom: this.#bloom?.room ?? null,
      echoes: [...this.#echoes.values()].filter((m) => m.isEnabled()).length,
    };
  }
}

function glow(scene: Scene, name: string, hex: string, strength: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString(hex).toLinearSpace().scale(strength);
  return m;
}

function point(
  scene: Scene,
  name: string,
  hex: string,
  intensity: number,
  range: number,
): PointLight {
  const l = new PointLight(name, Vector3.Zero(), scene);
  l.diffuse = Color3.FromHexString(hex);
  l.specular = l.diffuse.scale(0.3);
  l.intensity = intensity;
  l.range = range;
  return l;
}

const dist2 = (a: { x: number; z: number }, b: FloorPoint) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** What a room's mesh shows: its colour, its things fixed, and each door's state. One key, one mesh. */
function roomKey(room: CrookedRoom, view: CrookedHouseView, joy: number): string {
  const fixed = room.things
    .map((t) => (crookedThings(room, view).includes(t) ? '0' : '1'))
    .join('');
  const doors = doorsOf(CROOKED_HOUSE, room.id)
    .map((d) => doorState(d, view).kind[0] ?? '')
    .join('');
  return `${room.id}-j${String(Math.round(joy * 100))}-${fixed}-${doors}`;
}

/** A room's parts, room-local: shell, rug, lamp, things, and shut doors with their locks. */
function roomParts(room: CrookedRoom, view: CrookedHouseView, joy: number): Part[] {
  const { box } = room;
  const gaps: WallGap[] = [];
  const parts: Part[] = [];
  const crooked = new Set(crookedThings(room, view).map((t) => t.id));
  for (const door of doorsOf(CROOKED_HOUSE, room.id)) {
    const end = doorEnd(door, room.id);
    if (!end) continue;
    gaps.push({ side: end.side, at: end.at, width: CROOKED_WALK.doorWidth });
    const local = { x: end.point.x - box.x, z: end.point.z - box.z };
    const state = doorState(door, view);
    if (state.kind !== 'open') {
      parts.push(...doorSlab([local.x, 0, local.z], end.side, CROOKED_WALK.doorWidth, joy));
      // The padlock hangs on my side of the door.
      if (state.kind === 'locked') {
        parts.push(...padlock([local.x + end.inward.x * 0.2, 0.95, local.z + end.inward.z * 0.2]));
      }
    }
    // Stairs (a door to another floor): steps up into the gap.
    const there = farEnd(door, room.id);
    if (there && there.room.floor > room.floor) {
      for (let i = 0; i < 5; i++) {
        const back = 1.6 - i * 0.32;
        parts.push(
          blk(
            1.2,
            0.2 + i * 0.2,
            0.34,
            [local.x + end.inward.x * back, 0.1 + i * 0.1, local.z + end.inward.z * back],
            joyed('#a67c52', joy),
            {
              round: 0.3,
            },
          ),
        );
      }
    }
  }
  parts.push(...shell(box.w, box.d, joy, room.look, gaps));
  if (room.kind !== 'attic') parts.push(...rug([0, 0, -0.2], Math.min(box.w, box.d) * 0.22, joy));
  // A lamp that is one of the room's crooked things stands as that thing.
  if (room.lamp && !room.things.some((t) => t.prop === 'lamp')) {
    const lamp = merged(lampStand(joy, joy >= 1));
    lamp.position.set(room.lamp[0], 0, room.lamp[1]);
    parts.push(lamp);
  }
  for (const thing of room.things) {
    parts.push(prop(thing.prop, thing.kind, !crooked.has(thing.id), joy, thing.at));
  }
  return parts;
}

/** The rooms the room view draws: mine and its neighbours on my floor. */
export function roomsAround(roomId: string): string[] {
  const room = roomOf(roomId);
  if (!room) return [];
  const near = doorsOf(CROOKED_HOUSE, roomId)
    .map((d) => farEnd(d, roomId)?.room)
    .filter((r): r is CrookedRoom => r !== undefined && r.floor === room.floor)
    .map((r) => r.id);
  return [roomId, ...near];
}

/** Every room on a floor (the dollhouse map). */
export const roomsOnFloor = (floor: number): string[] => roomsOn(floor).map((r) => r.id);
