// Side effect: scene.pick needs Ray (tap to jiggle).
import '@babylonjs/core/Culling/ray';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Logger } from '@babylonjs/core/Misc/logger';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import {
  ART_RULES,
  isSquishyCostume,
  type Body,
  type ClothingItem,
  type VisualRegistry,
} from '@heartpatch/shared';
import { accessoryAnchors, accessoryPieces, accessorySocket } from './accessory.js';
import { bodyArrays, bodyRingsFor, type MeshArrays } from './body-shape.js';
import {
  CONTACT_SHADOW,
  FINISH_CODE,
  FLOATER_BATCH,
  GLUM_FACE,
  LOD,
  SHADOW_LOOK,
  SQUISH_LOOK_CODE,
  VINYL,
  type SquishMove,
  type SquishyLook,
  type SquishyDetail,
  type SquishyLod,
} from './config.js';
import { batchUploads } from './batch-uploads.js';
import { createContactShadowMesh } from './contact-shadow.js';
import { floaterArrays } from './floater-shapes.js';
import { eventAttribute, eventRunning, type SquishEvent } from './motion.js';
import {
  squishyParams,
  type FloaterParams,
  type SquishyParams,
  type SquishySpecies,
} from './params.js';
import { rareGlowCode } from './rare-glow.js';
import { orientTriangles, partArrays } from './part-shapes.js';
import { partMatrix } from './placement.js';
import { SquishPlugin } from './squish-plugin.js';

/**
 * Draws many procedural squishies cheaply (CLAUDE.md rule 8):
 * - one shared vinyl material for every body and part;
 * - one mesh per body type and per part shape, shared by every squishy and
 *   drawn once with thin instances, so draw calls don't grow with the
 *   number of squishies (50 squishies of 7 body types ≈ 13 draw calls);
 * - colours, squash and placement are per-instance attributes;
 * - motion runs in the vertex shader from one uniform;
 * - a floater (a music note, say) is one more thin instance in its
 *   glyph's batch: one draw call while any squishy shows one, turned to face
 *   each camera just before it draws, and never a shadow caster.
 *
 * Render on demand (tech spec §6): call `update(now)` every frame from the
 * render loop driver and keep drawing while it returns true; adding,
 * moving or removing squishies also needs a redraw (`Stage.invalidate`).
 */

export interface SquishyPlacement {
  readonly x: number;
  readonly z: number;
  /** Ground height. */
  readonly y?: number;
  /** Heading in radians; 0 faces −z (towards the default camera). */
  readonly yaw?: number;
  /** Extra scale on top of the species' size (close-ups). */
  readonly scale?: number;
  /** A hop (#317): the body floats this far above `y`, world units; its shadow stays on the ground. */
  readonly lift?: number;
  /** Height scale about the feet (1 is none); the width is 1/√squash, keeping the volume. */
  readonly squash?: number;
  /** The contact shadow's width, times its size on the ground (it shrinks as the body rises). */
  readonly shadow?: number;
  /** The contact shadow's opacity, 0–1 (it fades as the body rises, #323). */
  readonly shadowAlpha?: number;
}

/** A face a squishy can pull on top of its own (#393): `glum`, not keen on its job. */
export type SquishyFace = 'glum';

export interface SquishyHandle {
  readonly id: number;
  readonly params: SquishyParams;
  /** `shadow` for the Hollow's rescue guardians (owner decision 7). */
  readonly look: SquishyLook;
}

/** `L`: the detail levels a field may use (`hero` only for the close-up's one squishy). */
export interface SquishyFieldOptions<L extends SquishyDetail = SquishyLod> {
  readonly registry: VisualRegistry;
  readonly lod: L;
  /** Idle breathing. Off keeps a still scene idle (render on demand). Default on. */
  readonly breathing?: boolean;
  /** A soft contact shadow under each squishy. Default on. */
  readonly shadows?: boolean;
  /**
   * A node every mesh hangs from (a battle rig): moving it moves the field's
   * squishies without re-uploading their buffers. Off: meshes stay frozen at
   * the origin.
   */
  readonly parent?: TransformNode;
}

export interface SquishyFieldStats<L extends SquishyDetail = SquishyLod> {
  readonly squishies: number;
  /** Meshes with at least one instance: the field's draw calls. */
  readonly meshes: number;
  /** Thin instances across those meshes (bodies, parts and shadows). */
  readonly instances: number;
  /** Squishies drawn with the shadow look (rescue guardians). */
  readonly shadowLook: number;
  /** Floaters drawn (camera-facing glyphs, one draw call per glyph kind on screen). */
  readonly floaters: number;
  readonly lod: L;
}

interface Instance {
  readonly owner: Squishy;
  /** The part on the squishy (kept, so a move only re-multiplies) and in the world. */
  readonly local: Matrix;
  readonly matrix: Matrix;
  readonly color: readonly [number, number, number, number];
  /** `SQUISH_LOOK_CODE` for this instance (eyes differ from the body). */
  readonly look: number;
  /** `FINISH_CODE` sum for this instance: its material tier, plus glow. */
  readonly finish: number;
  /** A floater, turned to face the camera every frame instead of following `local`. */
  readonly floater?: FloaterParams;
}

interface Squishy {
  readonly handle: SquishyHandle;
  world: Matrix;
  origin: [number, number, number, number];
  /** Placement scale, the ground under it, and the shadow's width factor and opacity (the shadow stays down when it hops). */
  scale: number;
  ground: number;
  shadow: number;
  shadowAlpha: number;
  event: SquishEvent | null;
  readonly instances: { batch: Batch; instance: Instance }[];
  /** The accessory it wears (#340), or null; its pieces are in `instances` too. */
  accessory: {
    readonly id: string;
    readonly instances: Instance[];
    /** How high it reaches above the ground point (placement scale 1). */
    readonly top: number;
  } | null;
  /**
   * Its own `crown` parts (a stem, a nightcap), put away while a crown
   * accessory is on, and its `ears`, put away under a hood too (#515).
   */
  readonly tuckParts: { batch: Batch; instance: Instance; slot: 'crown' | 'ears' }[];
  /** Its eyes and mouth, with where each sits on a plain face (a `face` reshapes them). */
  readonly faceParts: { batch: Batch; instance: Instance; slot: 'eyes' | 'mouth'; base: Matrix }[];
  face: SquishyFace | null;
  /** Its rare glow (#391): added to the codes of its glowing pieces, 0 below rare. */
  readonly rareGlow: number;
}

interface Batch {
  readonly key: string;
  readonly build: (lod: SquishyDetail) => MeshArrays & { readonly colors?: number[] };
  /** Bodies are pickable (tap to jiggle); parts aren't. */
  readonly pickable: boolean;
  readonly instances: Instance[];
  mesh: Mesh | null;
  /** Instances came or went: rebuild every buffer. */
  dirty: boolean;
  /** Only placements changed (a walk or a hop, #323): rewrite matrices and origins in place. */
  moved: boolean;
  /** The last uploaded origin buffer, rewritten in place on a move. */
  origins: Float32Array | null;
}

/** The eight corners of a mesh's own vertices' box (not the thin instances'), cached. */
const BASE_BOXES = new WeakMap<Mesh, Vector3[]>();
function baseBox(mesh: Mesh): Vector3[] | null {
  const cached = BASE_BOXES.get(mesh);
  if (cached) return cached;
  const pos = mesh.getVerticesData('position');
  if (!pos || pos.length < 3) return null;
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const at = new Vector3(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0);
    lo.minimizeInPlace(at);
    hi.maximizeInPlace(at);
  }
  const box: Vector3[] = [];
  for (const x of [lo.x, hi.x])
    for (const y of [lo.y, hi.y]) for (const z of [lo.z, hi.z]) box.push(new Vector3(x, y, z));
  BASE_BOXES.set(mesh, box);
  return box;
}

// Scratch for placing squishies and their shadows (no allocations while walking, #323).
const PLACE_SCALE = new Vector3();
const PLACE_TURN = new Quaternion();
const PLACE_AT = new Vector3();
const SHADOW_TURN = Quaternion.Identity();
const SHADOW_WORLD = new Matrix();
// Scratch for turning floaters to the camera.
const CAMERA_WORLD = new Matrix();
const PARENT_INVERSE = new Matrix();
const FLOATER_AT = new Vector3();
const FLOATER_WORLD = new Matrix();
const RIGHT = new Vector3();
const UP = new Vector3();
const FORWARD = new Vector3();
const DEG = Math.PI / 180;

function linear(rgb: readonly [number, number, number]): [number, number, number, number] {
  const c = new Color3(rgb[0], rgb[1], rgb[2]).toLinearSpace();
  return [c.r, c.g, c.b, 1];
}

/**
 * The shadow look baked into a colour, for when the shader isn't attached
 * (opt-in WebGPU): the body towards the tint, the eyes towards the glow.
 */
function shadowColor(color: Instance['color'], eyes: boolean): Instance['color'] {
  const k = eyes ? SHADOW_LOOK.eyeGlowMix : SHADOW_LOOK.tintMix;
  const [r, g, b] = eyes ? SHADOW_LOOK.glow : SHADOW_LOOK.tint;
  return [
    color[0] + (r - color[0]) * k,
    color[1] + (g - color[1]) * k,
    color[2] + (b - color[2]) * k,
    color[3],
  ];
}

export class SquishyField<L extends SquishyDetail = SquishyLod> {
  readonly #scene: Scene;
  readonly #registry: VisualRegistry;
  readonly #breathing: boolean;
  readonly #parent: TransformNode | null;
  readonly #material: PBRMaterial;
  readonly #plugin: SquishPlugin | null;
  readonly #batches = new Map<string, Batch>();
  readonly #squishies = new Map<number, Squishy>();
  readonly #shadow: Mesh | null;
  readonly #warned = new Set<string>();
  readonly #beforeRender: Observer<Scene> | null;
  readonly #beforeCamera: Observer<Camera>;
  #lod: L;
  /** Seconds on the squishy clock at the last `update` (floaters bob on it). */
  #time = 0;
  #shadowDirty = true;
  /** The shadows' last buffers, rewritten in place while the count holds. */
  #shadowMatrices: Float32Array | null = null;
  #shadowColors: Float32Array | null = null;
  #nextId = 1;
  /** Wall-clock ms at squishy-clock zero, set by the first `update` or `play`. */
  #clockStart: number | null = null;

  constructor(scene: Scene, options: SquishyFieldOptions<L>) {
    this.#scene = scene;
    this.#registry = options.registry;
    this.#lod = options.lod;
    this.#breathing = options.breathing ?? true;
    this.#parent = options.parent ?? null;

    const m = new PBRMaterial('squishy-vinyl', scene);
    m.albedoColor = Color3.White(); // per-instance colours multiply this
    m.metallic = 0;
    m.roughness = VINYL.roughness;
    // Glossy coat over a softer base: the soft-vinyl toy look (design doc §19).
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = VINYL.clearCoatIntensity;
    m.clearCoat.roughness = VINYL.clearCoatRoughness;
    // Squishies are the stars: scene fog (the battle arena's haze) never
    // washes out their colours (ART_BIBLE §1.8).
    m.fogEnabled = false;
    this.#material = m;
    // GLSL only (see squish-plugin.ts): under WebGPU squishies render still.
    this.#plugin = m.shaderLanguage === ShaderLanguage.GLSL ? new SquishPlugin(m) : null;

    this.#shadow = (options.shadows ?? true) ? createContactShadowMesh(scene) : null;
    if (this.#shadow && options.parent) this.#shadow.parent = options.parent;
    this.#beforeRender = scene.onBeforeRenderObservable.add(() => {
      this.flush();
    });
    // After every camera has moved for the frame, before anything draws.
    this.#beforeCamera = scene.onBeforeCameraRenderObservable.add((camera) => {
      this.#faceCamera(camera);
    });
  }

  /**
   * Adds a squishy of `species`; `instanceId` seeds everything that varies.
   * `look: 'shadow'` draws it as a rescue guardian from the Hollow, on the
   * same meshes and draw calls (a per-instance code, see squish-plugin.ts).
   */
  add(
    species: SquishySpecies,
    instanceId: string,
    placement: SquishyPlacement,
    look: SquishyLook = 'normal',
  ): SquishyHandle {
    const params = squishyParams(species, instanceId, this.#registry);
    for (const id of params.missing) {
      if (this.#warned.has(id)) continue;
      this.#warned.add(id);
      Logger.Warn(`Squishy "${species.id}" uses "${id}", which this client doesn't know.`);
    }
    const body = this.#registry.bodies.get(params.body.id);
    if (!body) throw new Error(`unknown body ${params.body.id}`); // squishyParams falls back
    const handle: SquishyHandle = { id: this.#nextId++, params, look };
    const squishy: Squishy = {
      handle,
      world: Matrix.Identity(),
      origin: [0, 0, 0, 0],
      scale: 1,
      ground: 0,
      shadow: 1,
      shadowAlpha: 1,
      event: null,
      instances: [],
      accessory: null,
      tuckParts: [],
      faceParts: [],
      face: null,
      // A rescue guardian wears the shadow look alone.
      rareGlow: look === 'shadow' ? 0 : rareGlowCode(species.rarity, species.visual.palette),
    };
    this.#squishies.set(handle.id, squishy);
    this.#layout(squishy, body, placement);
    return handle;
  }

  /**
   * Moves a squishy (e.g. after it walks to another tile). Its parts keep
   * their place on it, so this only re-places them (#323).
   */
  move(handle: SquishyHandle, placement: SquishyPlacement): void {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy) return;
    this.#place(squishy, placement);
    for (const { batch, instance } of squishy.instances) {
      instance.local.multiplyToRef(squishy.world, instance.matrix);
      batch.moved = true;
    }
    this.#shadowDirty = true;
  }

  /**
   * Puts a wardrobe accessory on a squishy (#340), or takes it off (null).
   * Its pieces join the shared part batches as the squishy's own instances,
   * so they breathe, squash and hop with it and add no draw calls for
   * shapes already in the scene. A rescue guardian never wears one.
   */
  setAccessory(handle: SquishyHandle, item: ClothingItem | null): void {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy || (squishy.accessory?.id ?? null) === (item?.id ?? null)) return;
    if (squishy.accessory) {
      const gone = new Set(squishy.accessory.instances);
      for (const { batch, instance } of squishy.instances) {
        if (!gone.has(instance)) continue;
        const i = batch.instances.indexOf(instance);
        if (i >= 0) batch.instances.splice(i, 1);
        batch.dirty = true;
      }
      const kept = squishy.instances.filter(({ instance }) => !gone.has(instance));
      squishy.instances.splice(0, squishy.instances.length, ...kept);
      squishy.accessory = null;
    }
    const anchors = handle.look === 'shadow' || !item ? [] : accessoryAnchors(item);
    // A hat goes where the squishy's own crown part was (like hair under a
    // hat), and a hood tucks its ears away too, so they never poke through
    // each other. They keep moving with it (they stay in `instances`) and
    // come back when the hat comes off.
    const hatOn = anchors.includes('crown');
    const hoodOn = hatOn && item?.visual.hood === true;
    for (const { batch, instance, slot } of squishy.tuckParts) {
      const tucked = slot === 'crown' ? hatOn : hoodOn;
      const i = batch.instances.indexOf(instance);
      if (tucked && i >= 0) batch.instances.splice(i, 1);
      else if (!tucked && i < 0) batch.instances.push(instance);
      else continue;
      batch.dirty = true;
    }
    if (!item || anchors.length === 0) return;
    const sockets = new Map(
      anchors.map((a) => [a, accessorySocket(handle.params, this.#registry.bodies, a)]),
    );
    // Accessories are plain vinyl, like Keeper clothing; a squishy costume
    // wears its rarity's finish, like a Keeper costume (#515). Any piece may
    // glow (the glow bit sits above every finish).
    const finish = isSquishyCostume(item) ? FINISH_CODE[ART_RULES.finishByRarity[item.rarity]] : 0;
    const instances: Instance[] = [];
    let top = 0;
    for (const p of accessoryPieces(item, (a) => sockets.get(a) ?? null)) {
      top = Math.max(top, p.at[1] + p.size[1] / 2);
      const batch = this.#batch(`part:${p.shape}`, (lod) => partArrays(p.shape, LOD[lod]), false);
      const local = Matrix.Compose(
        new Vector3(p.size[0], p.size[1], p.size[2]),
        Quaternion.RotationYawPitchRoll(p.turn[1] * DEG, p.turn[0] * DEG, p.turn[2] * DEG),
        new Vector3(p.at[0], p.at[1], p.at[2]),
      );
      const instance: Instance = {
        owner: squishy,
        local,
        matrix: local.multiply(squishy.world),
        color: linear(p.color),
        look: SQUISH_LOOK_CODE.normal,
        finish: finish + (p.glow ? FINISH_CODE.glow : 0),
      };
      batch.instances.push(instance);
      batch.dirty = true;
      squishy.instances.push({ batch, instance });
      instances.push(instance);
    }
    squishy.accessory = { id: item.id, instances, top };
  }

  /**
   * Pulls a face over the squishy's own (#393): `glum` half closes its eyes
   * and turns its mouth upside down; null puts its usual face back. Only the
   * parts' matrices change (like a move), so it costs no buffers or draw calls.
   */
  setFace(handle: SquishyHandle, face: SquishyFace | null): void {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy || squishy.face === face) return;
    squishy.face = face;
    for (const part of squishy.faceParts) {
      const m = part.instance.local;
      m.copyFrom(part.base);
      if (face === 'glum') {
        const m0 = part.base.m;
        const b = (i: number) => m0[i] ?? 0;
        if (part.slot === 'eyes') {
          // Rows are the scaled x, y and z axes: shorten y (the eye's height).
          const k = GLUM_FACE.eyeLid;
          m.setRowFromFloats(1, b(4) * k, b(5) * k, b(6) * k, b(7));
        } else {
          // Half a turn about the face's normal: the smile curves down.
          m.setRowFromFloats(0, -b(0), -b(1), -b(2), b(3));
          m.setRowFromFloats(1, -b(4), -b(5), -b(6), b(7));
        }
      }
      m.multiplyToRef(squishy.world, part.instance.matrix);
      part.batch.moved = true;
    }
  }

  /** The face it's pulling (#393), or null for its own. */
  faceOf(handle: SquishyHandle): SquishyFace | null {
    return this.#squishies.get(handle.id)?.face ?? null;
  }

  /**
   * How tall a squishy stands with its accessory on (a hat reaches above
   * its head), world units at placement scale 1.
   */
  heightOf(handle: SquishyHandle): number {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy) return handle.params.height;
    return Math.max(handle.params.height, squishy.accessory?.top ?? 0);
  }

  /** The accessory a squishy wears, or null. */
  accessoryOf(handle: SquishyHandle): string | null {
    return this.#squishies.get(handle.id)?.accessory?.id ?? null;
  }

  /** How many of a squishy's own parts its accessory has tucked away (a topper, ears under a hood). */
  tuckedOf(handle: SquishyHandle): number {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy) return 0;
    return squishy.tuckParts.filter(({ batch, instance }) => !batch.instances.includes(instance))
      .length;
  }

  remove(handle: SquishyHandle): void {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy) return;
    this.#detach(squishy);
    this.#squishies.delete(handle.id);
  }

  /** Plays a jiggle (tap), wobble (landing) or bounce (happy). `now` is wall-clock ms. */
  play(handle: SquishyHandle, move: SquishMove, now: number, strength = 1): void {
    const squishy = this.#squishies.get(handle.id);
    if (!squishy) return;
    squishy.event = { move, start: this.#clock(now), strength };
    for (const { batch } of squishy.instances) batch.dirty = true;
  }

  /**
   * Advances the squishy clock. Returns true while anything moves, so the
   * caller keeps drawing; false once everything is at rest.
   */
  update(now: number): boolean {
    const t = this.#clock(now);
    this.#time = t;
    if (this.#plugin) this.#plugin.time = t;
    if (!this.#plugin) return false; // nothing animates without the shader
    if (this.#breathing && this.#squishies.size > 0) return true;
    for (const s of this.#squishies.values()) if (eventRunning(s.event, t)) return true;
    return false;
  }

  /** True while `handle`'s move is still playing. */
  isPlaying(handle: SquishyHandle, now: number): boolean {
    const squishy = this.#squishies.get(handle.id);
    return squishy !== undefined && eventRunning(squishy.event, this.#clockAt(now));
  }

  /** Switches detail level (see `lodFor`, `heroLodFor`); rebuilds shared geometry only. */
  setLod(lod: L): void {
    if (lod === this.#lod) return;
    this.#lod = lod;
    for (const batch of this.#batches.values()) {
      batch.mesh?.dispose();
      batch.mesh = null;
      batch.dirty = true;
    }
  }

  get lod(): L {
    return this.#lod;
  }

  /** The squishy under a canvas point (CSS pixels), if any. */
  pick(x: number, y: number): SquishyHandle | null {
    this.flush();
    const bodies = new Map<Mesh, Batch>();
    for (const batch of this.#batches.values()) {
      if (batch.pickable && batch.mesh) bodies.set(batch.mesh, batch);
    }
    const hit = this.#scene.pick(x, y, (mesh) => mesh instanceof Mesh && bodies.has(mesh));
    if (!(hit.pickedMesh instanceof Mesh) || hit.thinInstanceIndex < 0) return null;
    const instance = bodies.get(hit.pickedMesh)?.instances[hit.thinInstanceIndex];
    return instance?.owner.handle ?? null;
  }

  /** World position of a squishy's middle, e.g. to tap it in tests. */
  centre(handle: SquishyHandle): Vector3 | null {
    const s = this.#squishies.get(handle.id);
    return s ? new Vector3(s.origin[0], s.origin[1] + s.origin[3] / 2, s.origin[2]) : null;
  }

  /**
   * How far a squishy reaches from its middle, world units: the farthest
   * corner of its drawn pieces' boxes (body, ears, spikes, accessory), so a
   * wide one is measured as it is, not by its height. Null if unknown or
   * not drawn yet.
   */
  reachOf(handle: SquishyHandle): number | null {
    const s = this.#squishies.get(handle.id);
    const mid = this.centre(handle);
    if (!s || !mid) return null;
    this.flush(); // the meshes are built on a flush
    const pieces = [...s.instances.map((e) => e.instance), ...(s.accessory?.instances ?? [])];
    const corner = new Vector3();
    let far = 0;
    for (const piece of pieces) {
      if (piece.floater) continue;
      const batch = [...this.#batches.values()].find((b) => b.instances.includes(piece));
      const box = batch?.mesh ? baseBox(batch.mesh) : null;
      if (!box) continue;
      for (const v of box) {
        Vector3.TransformCoordinatesToRef(v, piece.matrix, corner);
        far = Math.max(far, Vector3.Distance(corner, mid));
      }
    }
    return far > 0 ? far : null;
  }

  get handles(): SquishyHandle[] {
    return [...this.#squishies.values()].map((s) => s.handle);
  }

  get stats(): SquishyFieldStats<L> {
    this.flush();
    let meshes = 0;
    let instances = 0;
    for (const batch of this.#batches.values()) {
      if (batch.instances.length === 0) continue;
      meshes++;
      instances += batch.instances.length;
    }
    if (this.#shadow && this.#squishies.size > 0) {
      meshes++;
      instances += this.#squishies.size;
    }
    let shadowLook = 0;
    for (const s of this.#squishies.values()) if (s.handle.look === 'shadow') shadowLook++;
    let floaters = 0;
    for (const batch of this.#batches.values()) {
      if (batch.key.startsWith(FLOATER_BATCH)) floaters += batch.instances.length;
    }
    return {
      squishies: this.#squishies.size,
      meshes,
      instances,
      shadowLook,
      floaters,
      lod: this.#lod,
    };
  }

  /** Uploads changed instance buffers. Runs before every render; call it to force one. */
  flush(): void {
    for (const batch of this.#batches.values()) {
      if (batch.dirty) this.#upload(batch);
      else if (batch.moved) this.#uploadMoves(batch);
    }
    if (this.#shadowDirty) this.#uploadShadows();
  }

  dispose(): void {
    if (this.#beforeRender) this.#scene.onBeforeRenderObservable.remove(this.#beforeRender);
    this.#scene.onBeforeCameraRenderObservable.remove(this.#beforeCamera);
    for (const batch of this.#batches.values()) batch.mesh?.dispose();
    this.#batches.clear();
    this.#squishies.clear();
    if (this.#shadow) {
      this.#shadow.material?.dispose(true, true);
      this.#shadow.dispose();
    }
    this.#material.dispose();
  }

  #clockAt(now: number): number {
    return this.#clockStart === null ? 0 : (now - this.#clockStart) / 1000;
  }

  #clock(now: number): number {
    this.#clockStart ??= now;
    return this.#clockAt(now);
  }

  #batch(key: string, build: (lod: SquishyDetail) => MeshArrays, pickable: boolean): Batch {
    let batch = this.#batches.get(key);
    if (!batch) {
      batch = {
        key,
        build,
        pickable,
        instances: [],
        mesh: null,
        dirty: true,
        moved: false,
        origins: null,
      };
      this.#batches.set(key, batch);
    }
    return batch;
  }

  /** The squishy's world matrix, origin, ground and shadow, in place. */
  #place(squishy: Squishy, placement: SquishyPlacement): void {
    const scale = placement.scale ?? 1;
    const squash = placement.squash ?? 1;
    const wide = scale / Math.sqrt(squash);
    const ground = placement.y ?? 0;
    PLACE_AT.set(placement.x, ground + (placement.lift ?? 0), placement.z);
    Quaternion.RotationYawPitchRollToRef(placement.yaw ?? 0, 0, 0, PLACE_TURN);
    Matrix.ComposeToRef(
      PLACE_SCALE.set(wide, scale * squash, wide),
      PLACE_TURN,
      PLACE_AT,
      squishy.world,
    );
    squishy.scale = scale;
    squishy.ground = ground;
    squishy.shadow = placement.shadow ?? 1;
    squishy.shadowAlpha = placement.shadowAlpha ?? 1;
    const o = squishy.origin;
    o[0] = PLACE_AT.x;
    o[1] = PLACE_AT.y;
    o[2] = PLACE_AT.z;
    o[3] = squishy.handle.params.height * scale;
  }

  #layout(squishy: Squishy, body: Body, placement: SquishyPlacement): void {
    const { params } = squishy.handle;
    this.#place(squishy, placement);

    const shadow = squishy.handle.look === 'shadow';
    const tier = FINISH_CODE[params.finish];
    // Rare and up glow (#391) on the torso, head and sticking-out parts.
    const { rareGlow } = squishy;
    const attach = (
      batch: Batch,
      local: Matrix,
      color: Instance['color'],
      finish: number,
      eyes = false,
      floater?: FloaterParams,
    ) => {
      const look = !shadow
        ? SQUISH_LOOK_CODE.normal
        : eyes
          ? SQUISH_LOOK_CODE.shadowEyes
          : SQUISH_LOOK_CODE.shadow;
      const instance: Instance = {
        owner: squishy,
        local,
        matrix: local.multiply(squishy.world),
        // Without the shader (opt-in WebGPU) the look is baked into the colour.
        color: shadow && !this.#plugin ? shadowColor(color, eyes) : color,
        look,
        finish,
        ...(floater && { floater }),
      };
      batch.instances.push(instance);
      batch.dirty = true;
      const entry = { batch, instance };
      squishy.instances.push(entry);
      return entry;
    };

    const bodyBatchOf = (shape: Body) =>
      this.#batch(
        `body:${shape.id}`,
        (lod) => orientTriangles(bodyArrays(shape, bodyRingsFor(shape, LOD[lod].bodyRings))),
        true,
      );
    const [sx, sy, sz] = params.body.scale;
    const glow = (on: boolean) => (on ? FINISH_CODE.glow : 0);
    const torsoAt: [number, number, number] = [0, params.lift, 0];
    // Sparkle kept off the face: the torso and head carry the face, parts don't.
    const offFace = params.sparkleOffFace && tier > 0 ? FINISH_CODE.offFace : 0;
    attach(
      bodyBatchOf(body),
      Matrix.Scaling(sx, sy, sz).multiply(Matrix.Translation(...torsoAt)),
      linear(params.body.color),
      tier + glow(params.body.glow) + offFace + rareGlow,
    );
    // A separate head: one more instance in its body kind's batch.
    const headBody = params.head ? this.#registry.bodies.get(params.head.id) : undefined;
    if (params.head && headBody) {
      const [hx, hy, hz] = params.head.scale;
      attach(
        bodyBatchOf(headBody),
        Matrix.Scaling(hx, hy, hz).multiply(Matrix.Translation(...params.head.offset)),
        linear(params.body.color),
        tier + glow(params.body.glow) + offFace + rareGlow,
      );
    }

    for (const part of params.parts) {
      const batch = this.#batch(
        `part:${part.shape}`,
        (lod) => partArrays(part.shape, LOD[lod]),
        false,
      );
      const color = linear(part.color);
      // Faces and patterns stay plain vinyl; sticking-out parts share the body's tier and glow.
      const finish = (part.surface ? 0 : tier + rareGlow) + glow(part.glow);
      const onHead = part.host === 'head' && params.head && headBody;
      const hostBody = onHead ? headBody : body;
      const hostScale = onHead ? params.head.scale : params.body.scale;
      const hostAt = onHead ? params.head.offset : torsoAt;
      for (const p of part.placements) {
        const local = Matrix.FromArray(partMatrix(hostBody, hostScale, part, p, hostAt));
        const entry = attach(batch, local, color, finish, part.slot === 'eyes');
        if (part.slot === 'crown' || part.slot === 'ears') {
          squishy.tuckParts.push({ ...entry, slot: part.slot });
        }
        if (part.slot === 'eyes' || part.slot === 'mouth') {
          squishy.faceParts.push({ ...entry, slot: part.slot, base: local.clone() });
        }
      }
    }

    // A floater: never on a rescue guardian (the shadow look is the squishy alone).
    const floater = params.floater;
    if (floater && !shadow) {
      const batch = this.#batch(
        `${FLOATER_BATCH}${floater.glyph}`,
        (lod) => floaterArrays(floater.glyph, LOD[lod]),
        false,
      );
      // Placed upright for now; `#faceCamera` turns it to the view before every draw.
      const local = Matrix.Compose(
        new Vector3(floater.size, floater.size, floater.size),
        Quaternion.Identity(),
        new Vector3(...floater.at),
      );
      // Plain vinyl like a face (a flat glyph has no rim for a tier), glowing with the parts.
      attach(batch, local, linear(floater.color), glow(floater.glow), false, floater);
    }
    this.#shadowDirty = true;
  }

  /**
   * Turns every floater to face `camera` (a billboard: its plane parallel to
   * the screen), at its place beside its squishy plus a gentle bob. Bobs only
   * while the field breathes, so Reduce Motion and still scenes hold it still.
   * Runs before each camera draws; costs nothing without floaters.
   */
  #faceCamera(camera: Camera): void {
    let parentWorld: Matrix | null = null;
    let parentInverse: Matrix | null = null;
    /** The rig's overall scale: the cube root of its volume scale (see below). */
    let parentScale = 1;
    let cameraWorld: Matrix | null = null;
    const bobbing = this.#breathing && this.#plugin !== null;
    for (const batch of this.#batches.values()) {
      const { mesh, instances } = batch;
      if (!batch.key.startsWith(FLOATER_BATCH) || !mesh || instances.length === 0) continue;
      if (!cameraWorld) {
        cameraWorld = camera.getViewMatrix().invertToRef(CAMERA_WORLD);
        // The camera's own axes: the glyph's x, y and z, so it lies parallel to the screen.
        Vector3.FromArrayToRef(cameraWorld.m, 0, RIGHT);
        Vector3.FromArrayToRef(cameraWorld.m, 4, UP);
        Vector3.FromArrayToRef(cameraWorld.m, 8, FORWARD);
        if (this.#parent) {
          parentWorld = this.#parent.computeWorldMatrix();
          parentInverse = parentWorld.invertToRef(PARENT_INVERSE);
          // A battle rig scales its fighter: uniformly to shrink it (a swap,
          // a scoot, charmed) and non-uniformly to squash and stretch it,
          // keeping its volume. The cube root of the volume scale follows the
          // first and ignores the second, so the note shrinks and vanishes
          // with its squishy but doesn't squash like a body.
          parentScale = Math.cbrt(Math.abs(parentWorld.determinant()));
        }
      }
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const f = inst?.floater;
        if (!inst || !f) continue;
        const { owner } = inst;
        Vector3.TransformCoordinatesFromFloatsToRef(
          f.at[0],
          f.at[1],
          f.at[2],
          owner.world,
          FLOATER_AT,
        );
        if (bobbing && f.bob.height > 0) {
          const phase = owner.handle.params.motion.phase;
          FLOATER_AT.y +=
            f.bob.height * owner.scale * Math.sin(2 * Math.PI * (f.bob.speed * this.#time + phase));
        }
        // In the scene's space (position and bob go through the rig like the
        // body's vertices do), so it faces the camera however a rig turns.
        if (parentWorld) Vector3.TransformCoordinatesToRef(FLOATER_AT, parentWorld, FLOATER_AT);
        const s = f.size * owner.scale * parentScale;
        Matrix.FromValuesToRef(
          RIGHT.x * s,
          RIGHT.y * s,
          RIGHT.z * s,
          0,
          UP.x * s,
          UP.y * s,
          UP.z * s,
          0,
          FORWARD.x * s,
          FORWARD.y * s,
          FORWARD.z * s,
          0,
          FLOATER_AT.x,
          FLOATER_AT.y,
          FLOATER_AT.z,
          1,
          FLOATER_WORLD,
        );
        // Back into the rig's space: the mesh hangs from it.
        if (parentInverse) FLOATER_WORLD.multiplyToRef(parentInverse, inst.matrix);
        else inst.matrix.copyFrom(FLOATER_WORLD);
        mesh.thinInstanceSetMatrixAt(i, inst.matrix, false);
      }
      mesh.thinInstanceBufferUpdated('matrix');
    }
  }

  #detach(squishy: Squishy): void {
    for (const { batch, instance } of squishy.instances) {
      const i = batch.instances.indexOf(instance);
      if (i >= 0) batch.instances.splice(i, 1);
      batch.dirty = true;
    }
    squishy.instances.length = 0;
    this.#shadowDirty = true;
  }

  #upload(batch: Batch): void {
    batch.dirty = false;
    batch.moved = false;
    const n = batch.instances.length;
    if (n === 0) {
      batch.mesh?.setEnabled(false);
      return;
    }
    let mesh = batch.mesh;
    if (!mesh) {
      mesh = new Mesh(`squishy-${batch.key}-${this.#lod}`, this.#scene);
      const arrays = batch.build(this.#lod);
      const data = new VertexData();
      data.positions = arrays.positions;
      data.normals = arrays.normals;
      data.indices = arrays.indices;
      // Floaters darken their outline this way; colours multiply the instance's.
      if (arrays.colors) data.colors = arrays.colors;
      data.applyToMesh(mesh);
      mesh.material = this.#material;
      mesh.isPickable = batch.pickable;
      mesh.thinInstanceEnablePicking = batch.pickable;
      // Squash and bounce move vertices past the bounds; a handful of meshes
      // isn't worth culling.
      mesh.alwaysSelectAsActiveMesh = true;
      if (this.#parent) mesh.parent = this.#parent;
      else mesh.freezeWorldMatrix();
      batch.mesh = mesh;
    }
    mesh.setEnabled(true);
    batchUploads.count++;

    const matrices = new Float32Array(n * 16);
    const colors = new Float32Array(n * 4);
    const origins = new Float32Array(n * 4);
    const motions = new Float32Array(n * 4);
    const events = new Float32Array(n * 4);
    batch.instances.forEach((inst, i) => {
      inst.matrix.copyToArray(matrices, i * 16);
      colors.set(inst.color, i * 4);
      const { owner } = inst;
      origins.set(owner.origin, i * 4);
      const { phase, rate, amplitude } = owner.handle.params.motion;
      motions.set([phase, rate, this.#breathing ? amplitude : 0, inst.look], i * 4);
      events.set(eventAttribute(owner.event), i * 4);
      events[i * 4 + 3] = inst.finish;
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceSetBuffer('squishOrigin', origins, 4, false);
    mesh.thinInstanceSetBuffer('squishMotion', motions, 4, true);
    mesh.thinInstanceSetBuffer('squishEvent', events, 4, false);
    if (batch.pickable) mesh.thinInstanceRefreshBoundingInfo();
    batch.origins = origins;
  }

  /** Rewrites a batch's matrices and origins in place after moves (no new buffers). */
  #uploadMoves(batch: Batch): void {
    batch.moved = false;
    const { mesh, origins } = batch;
    if (!mesh || !origins) return;
    batch.instances.forEach((inst, i) => {
      // Through the mesh, so its world-matrix copies (picking) see the move too.
      mesh.thinInstanceSetMatrixAt(i, inst.matrix, false);
      origins.set(inst.owner.origin, i * 4);
    });
    mesh.thinInstanceBufferUpdated('matrix');
    mesh.thinInstanceBufferUpdated('squishOrigin');
    if (batch.pickable) mesh.thinInstanceRefreshBoundingInfo();
  }

  #uploadShadows(): void {
    this.#shadowDirty = false;
    const shadow = this.#shadow;
    if (!shadow) return;
    const n = this.#squishies.size;
    shadow.setEnabled(n > 0);
    if (n === 0) return;
    // Same count: rewrite the buffers in place (a walk or a hop moves them every frame).
    const kept = this.#shadowMatrices?.length === n * 16 ? this.#shadowMatrices : null;
    const fresh = kept === null || this.#shadowColors === null;
    const matrices = fresh ? new Float32Array(n * 16) : kept;
    const colors = fresh || !this.#shadowColors ? new Float32Array(n * 4) : this.#shadowColors;
    let i = 0;
    for (const s of this.#squishies.values()) {
      const body = this.#registry.bodies.get(s.handle.params.body.id);
      const [sx, , sz] = s.handle.params.body.scale;
      const d =
        Math.max((body?.width ?? 1) * sx, (body?.depth ?? 1) * sz) *
        s.scale *
        CONTACT_SHADOW.scale *
        s.shadow;
      Matrix.ComposeToRef(
        PLACE_SCALE.set(d, 1, d),
        SHADOW_TURN,
        PLACE_AT.set(s.origin[0], s.ground + 0.01, s.origin[2]),
        SHADOW_WORLD,
      ).copyToArray(matrices, i * 16);
      colors[i * 4] = 1;
      colors[i * 4 + 1] = 1;
      colors[i * 4 + 2] = 1;
      colors[i * 4 + 3] = s.shadowAlpha;
      i++;
    }
    if (fresh) {
      this.#shadowMatrices = matrices;
      this.#shadowColors = colors;
      shadow.thinInstanceSetBuffer('matrix', matrices, 16, false);
      shadow.thinInstanceSetBuffer('color', colors, 4, false);
    } else {
      shadow.thinInstanceBufferUpdated('matrix');
      shadow.thinInstanceBufferUpdated('color');
    }
  }
}
