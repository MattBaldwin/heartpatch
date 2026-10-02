import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Logger } from '@babylonjs/core/Misc/logger';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { KeeperConfig, KeeperData, PartShape } from '@heartpatch/shared';
import { CONTACT_SHADOW, VINYL, type SquishMove, type SquishyLod } from '../config.js';
import { createContactShadowMesh } from '../contact-shadow.js';
import { eventAttribute, eventRunning, type SquishEvent } from '../motion.js';
import { partArrays } from '../part-shapes.js';
import { SquishPlugin } from '../squish-plugin.js';
import { KEEPER_LOD } from './keeper-config.js';
import type { KeeperItem } from './keeper-items.js';
import { keeperParams, type KeeperParams } from './keeper-params.js';

/**
 * Draws Keepers cheaply, the way `SquishyField` draws squishies (CLAUDE.md
 * rule 8):
 * - one shared vinyl material, the squishies' clearcoat look;
 * - one mesh per primitive shape, shared by every Keeper and drawn with thin
 *   instances, so draw calls don't grow with the number of Keepers (five
 *   shapes plus the shadow, however many Keepers);
 * - colours are per-instance attributes;
 * - cheers (a hop, a wiggle) run in the vertex shader from one uniform, using
 *   the squishies' squash plugin. Keepers never breathe, so an idle Keeper
 *   never asks for a frame (render on demand, tech spec §6).
 *
 * Call `update(now)` from the frame driver while it returns true (a cheer is
 * playing); adding, moving or removing Keepers also needs a redraw
 * (`Stage.invalidate`).
 */

export interface KeeperPlacement {
  readonly x: number;
  readonly z: number;
  /** Ground height. */
  readonly y?: number;
  /** Heading in radians; 0 faces −z (towards the default camera). */
  readonly yaw?: number;
  /**
   * Leans back from the feet, radians, so the face looks up at a camera that
   * looks down on it (the map camera is steep; a chibi's hair would hide it).
   */
  readonly lean?: number;
  readonly scale?: number;
}

export interface KeeperHandle {
  readonly id: number;
  readonly params: KeeperParams;
}

export interface KeeperFieldOptions {
  readonly data: KeeperData;
  readonly lod: SquishyLod;
  /** A soft contact shadow under each Keeper. Default on. */
  readonly shadows?: boolean;
}

export interface KeeperFieldStats {
  readonly keepers: number;
  /** Meshes with at least one instance: the field's draw calls (shadow included). */
  readonly meshes: number;
  /** Thin instances across those meshes. */
  readonly instances: number;
  readonly lod: SquishyLod;
}

interface Instance {
  readonly owner: Keeper;
  readonly matrix: Matrix;
  readonly color: readonly [number, number, number, number];
}

interface Keeper {
  readonly handle: KeeperHandle;
  world: Matrix;
  /** Ground point (xyz) and height (w), for the squash shader. */
  origin: [number, number, number, number];
  scale: number;
  event: SquishEvent | null;
  readonly instances: { batch: Batch; instance: Instance }[];
}

interface Batch {
  readonly shape: PartShape;
  readonly instances: Instance[];
  mesh: Mesh | null;
  dirty: boolean;
}

const DEG = Math.PI / 180;

function linear(rgb: readonly [number, number, number]): [number, number, number, number] {
  const c = new Color3(rgb[0], rgb[1], rgb[2]).toLinearSpace();
  return [c.r, c.g, c.b, 1];
}

export class KeeperField {
  readonly #scene: Scene;
  readonly #data: KeeperData;
  readonly #material: PBRMaterial;
  readonly #plugin: SquishPlugin | null;
  readonly #batches = new Map<PartShape, Batch>();
  readonly #keepers = new Map<number, Keeper>();
  readonly #shadow: Mesh | null;
  readonly #warned = new Set<string>();
  readonly #beforeRender: Observer<Scene> | null;
  #lod: SquishyLod;
  #shadowDirty = true;
  #nextId = 1;
  /** Wall-clock ms at Keeper-clock zero, set by the first `update` or `play`. */
  #clockStart: number | null = null;

  constructor(scene: Scene, options: KeeperFieldOptions) {
    this.#scene = scene;
    this.#data = options.data;
    this.#lod = options.lod;

    const m = new PBRMaterial('keeper-vinyl', scene);
    m.albedoColor = Color3.White(); // per-instance colours multiply this
    m.metallic = 0;
    m.roughness = VINYL.roughness;
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = VINYL.clearCoatIntensity;
    m.clearCoat.roughness = VINYL.clearCoatRoughness;
    this.#material = m;
    // GLSL only (see squish-plugin.ts): under WebGPU Keepers don't hop.
    this.#plugin = m.shaderLanguage === ShaderLanguage.GLSL ? new SquishPlugin(m) : null;

    this.#shadow = (options.shadows ?? true) ? createContactShadowMesh(scene) : null;
    this.#beforeRender = scene.onBeforeRenderObservable.add(() => {
      this.flush();
    });
  }

  /** Adds a Keeper; `items` are worn clothing (one per slot). */
  add(
    config: KeeperConfig,
    placement: KeeperPlacement,
    items: readonly KeeperItem[] = [],
  ): KeeperHandle {
    const params = keeperParams(config, this.#data, items);
    for (const id of params.missing) {
      if (this.#warned.has(id)) continue;
      this.#warned.add(id);
      Logger.Warn(`A Keeper uses "${id}", which this client doesn't know.`);
    }
    const handle: KeeperHandle = { id: this.#nextId++, params };
    const keeper: Keeper = {
      handle,
      world: Matrix.Identity(),
      origin: [0, 0, 0, 0],
      scale: 1,
      event: null,
      instances: [],
    };
    this.#keepers.set(handle.id, keeper);
    this.#layout(keeper, placement);
    return handle;
  }

  move(handle: KeeperHandle, placement: KeeperPlacement): void {
    const keeper = this.#keepers.get(handle.id);
    if (!keeper) return;
    this.#detach(keeper);
    this.#layout(keeper, placement);
  }

  remove(handle: KeeperHandle): void {
    const keeper = this.#keepers.get(handle.id);
    if (!keeper) return;
    this.#detach(keeper);
    this.#keepers.delete(handle.id);
  }

  /** Removes every Keeper. */
  clear(): void {
    for (const keeper of this.#keepers.values()) this.#detach(keeper);
    this.#keepers.clear();
  }

  /** A cheer: `bounce` is a happy jump, `jiggle` a wiggle, `wobble` an "aww". `now` is wall-clock ms. */
  play(handle: KeeperHandle, move: SquishMove, now: number, strength = 1): void {
    const keeper = this.#keepers.get(handle.id);
    if (!keeper) return;
    keeper.event = { move, start: this.#clock(now), strength };
    for (const { batch } of keeper.instances) batch.dirty = true;
  }

  /** Advances the Keeper clock; true while a cheer plays (keep drawing), else false. */
  update(now: number): boolean {
    const t = this.#clock(now);
    if (!this.#plugin) return false; // nothing moves without the shader
    this.#plugin.time = t;
    for (const k of this.#keepers.values()) if (eventRunning(k.event, t)) return true;
    return false;
  }

  isPlaying(handle: KeeperHandle, now: number): boolean {
    const keeper = this.#keepers.get(handle.id);
    return keeper !== undefined && eventRunning(keeper.event, this.#clockAt(now));
  }

  /** Switches detail level (`lodFor`); rebuilds the shared geometry only. */
  setLod(lod: SquishyLod): void {
    if (lod === this.#lod) return;
    this.#lod = lod;
    for (const batch of this.#batches.values()) {
      batch.mesh?.dispose();
      batch.mesh = null;
      batch.dirty = true;
    }
  }

  get lod(): SquishyLod {
    return this.#lod;
  }

  get handles(): KeeperHandle[] {
    return [...this.#keepers.values()].map((k) => k.handle);
  }

  /** World position of a Keeper's middle (tests, and pointing the camera). */
  centre(handle: KeeperHandle): Vector3 | null {
    const k = this.#keepers.get(handle.id);
    return k ? new Vector3(k.origin[0], k.origin[1] + k.origin[3] / 2, k.origin[2]) : null;
  }

  get stats(): KeeperFieldStats {
    this.flush();
    let meshes = 0;
    let instances = 0;
    for (const batch of this.#batches.values()) {
      if (batch.instances.length === 0) continue;
      meshes++;
      instances += batch.instances.length;
    }
    if (this.#shadow && this.#keepers.size > 0) {
      meshes++;
      instances += this.#keepers.size;
    }
    return { keepers: this.#keepers.size, meshes, instances, lod: this.#lod };
  }

  /** Uploads changed instance buffers. Runs before every render; call it to force one. */
  flush(): void {
    for (const batch of this.#batches.values()) if (batch.dirty) this.#upload(batch);
    if (this.#shadowDirty) this.#uploadShadows();
  }

  dispose(): void {
    if (this.#beforeRender) this.#scene.onBeforeRenderObservable.remove(this.#beforeRender);
    for (const batch of this.#batches.values()) batch.mesh?.dispose();
    this.#batches.clear();
    this.#keepers.clear();
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

  #batch(shape: PartShape): Batch {
    let batch = this.#batches.get(shape);
    if (!batch) {
      batch = { shape, instances: [], mesh: null, dirty: true };
      this.#batches.set(shape, batch);
    }
    return batch;
  }

  #layout(keeper: Keeper, placement: KeeperPlacement): void {
    const { params } = keeper.handle;
    const scale = placement.scale ?? 1;
    const ground = new Vector3(placement.x, placement.y ?? 0, placement.z);
    keeper.world = Matrix.Compose(
      new Vector3(scale, scale, scale),
      Quaternion.RotationYawPitchRoll(placement.yaw ?? 0, placement.lean ?? 0, 0),
      ground,
    );
    keeper.scale = scale;
    keeper.origin = [ground.x, ground.y, ground.z, params.height * scale];
    for (const p of params.pieces) {
      const local = Matrix.Compose(
        new Vector3(p.size[0], p.size[1], p.size[2]),
        Quaternion.RotationYawPitchRoll(p.turn[1] * DEG, p.turn[0] * DEG, p.turn[2] * DEG),
        new Vector3(p.at[0], p.at[1], p.at[2]),
      );
      const instance: Instance = {
        owner: keeper,
        matrix: local.multiply(keeper.world),
        color: linear(p.color),
      };
      const batch = this.#batch(p.shape);
      batch.instances.push(instance);
      batch.dirty = true;
      keeper.instances.push({ batch, instance });
    }
    this.#shadowDirty = true;
  }

  #detach(keeper: Keeper): void {
    for (const { batch, instance } of keeper.instances) {
      const i = batch.instances.indexOf(instance);
      if (i >= 0) batch.instances.splice(i, 1);
      batch.dirty = true;
    }
    keeper.instances.length = 0;
    this.#shadowDirty = true;
  }

  #upload(batch: Batch): void {
    batch.dirty = false;
    const n = batch.instances.length;
    if (n === 0) {
      batch.mesh?.setEnabled(false);
      return;
    }
    let mesh = batch.mesh;
    if (!mesh) {
      mesh = new Mesh(`keeper-${batch.shape}-${this.#lod}`, this.#scene);
      const arrays = partArrays(batch.shape, KEEPER_LOD[this.#lod]);
      const data = new VertexData();
      data.positions = arrays.positions;
      data.normals = arrays.normals;
      data.indices = arrays.indices;
      data.applyToMesh(mesh);
      mesh.material = this.#material;
      mesh.isPickable = false;
      // Cheers move vertices past the bounds; a handful of meshes isn't worth culling.
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.freezeWorldMatrix();
      batch.mesh = mesh;
    }
    mesh.setEnabled(true);

    const matrices = new Float32Array(n * 16);
    const colors = new Float32Array(n * 4);
    const origins = new Float32Array(n * 4);
    const motions = new Float32Array(n * 4); // no breathing: Keepers stand still
    const events = new Float32Array(n * 4);
    batch.instances.forEach((inst, i) => {
      inst.matrix.copyToArray(matrices, i * 16);
      colors.set(inst.color, i * 4);
      origins.set(inst.owner.origin, i * 4);
      events.set(eventAttribute(inst.owner.event), i * 4);
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceSetBuffer('squishOrigin', origins, 4, true);
    mesh.thinInstanceSetBuffer('squishMotion', motions, 4, true);
    mesh.thinInstanceSetBuffer('squishEvent', events, 4, false);
  }

  #uploadShadows(): void {
    this.#shadowDirty = false;
    const shadow = this.#shadow;
    if (!shadow) return;
    const n = this.#keepers.size;
    shadow.setEnabled(n > 0);
    if (n === 0) return;
    const matrices = new Float32Array(n * 16);
    const rot = Quaternion.Identity();
    let i = 0;
    for (const k of this.#keepers.values()) {
      const d = k.handle.params.width * k.scale * CONTACT_SHADOW.scale;
      Matrix.Compose(
        new Vector3(d, 1, d),
        rot,
        new Vector3(k.origin[0], k.origin[1] + 0.01, k.origin[2]),
      ).copyToArray(matrices, i * 16);
      i++;
    }
    shadow.thinInstanceSetBuffer('matrix', matrices, 16, false);
  }
}
