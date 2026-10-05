// Side effect: scene.pick needs Ray (tap to jiggle).
import '@babylonjs/core/Culling/ray';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Logger } from '@babylonjs/core/Misc/logger';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { Body, VisualRegistry } from '@heartpatch/shared';
import { bodyArrays, type MeshArrays } from './body-shape.js';
import {
  CONTACT_SHADOW,
  LOD,
  SHADOW_LOOK,
  SQUISH_LOOK_CODE,
  VINYL,
  type SquishMove,
  type SquishyLook,
  type SquishyDetail,
  type SquishyLod,
} from './config.js';
import { createContactShadowMesh } from './contact-shadow.js';
import { eventAttribute, eventRunning, type SquishEvent } from './motion.js';
import { squishyParams, type SquishyParams, type SquishySpecies } from './params.js';
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
 * - motion runs in the vertex shader from one uniform.
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
}

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
   * the origin. (Ported from the battle overhaul branch for the look prototypes.)
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
  readonly lod: L;
}

interface Instance {
  readonly owner: Squishy;
  readonly matrix: Matrix;
  readonly color: readonly [number, number, number, number];
  /** `SQUISH_LOOK_CODE` for this instance (eyes differ from the body). */
  readonly look: number;
}

interface Squishy {
  readonly handle: SquishyHandle;
  world: Matrix;
  origin: [number, number, number, number];
  event: SquishEvent | null;
  readonly instances: { batch: Batch; instance: Instance }[];
}

interface Batch {
  readonly key: string;
  readonly build: (lod: SquishyDetail) => MeshArrays;
  /** Bodies are pickable (tap to jiggle); parts aren't. */
  readonly pickable: boolean;
  readonly instances: Instance[];
  mesh: Mesh | null;
  dirty: boolean;
}

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
  readonly #material: PBRMaterial;
  readonly #plugin: SquishPlugin | null;
  readonly #batches = new Map<string, Batch>();
  readonly #squishies = new Map<number, Squishy>();
  readonly #shadow: Mesh | null;
  readonly #parent: TransformNode | null;
  readonly #warned = new Set<string>();
  readonly #beforeRender: Observer<Scene> | null;
  #lod: L;
  #shadowDirty = true;
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
    this.#material = m;
    // GLSL only (see squish-plugin.ts): under WebGPU squishies render still.
    this.#plugin = m.shaderLanguage === ShaderLanguage.GLSL ? new SquishPlugin(m) : null;

    this.#shadow = (options.shadows ?? true) ? createContactShadowMesh(scene) : null;
    if (this.#shadow && options.parent) this.#shadow.parent = options.parent;
    this.#beforeRender = scene.onBeforeRenderObservable.add(() => {
      this.flush();
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
      event: null,
      instances: [],
    };
    this.#squishies.set(handle.id, squishy);
    this.#layout(squishy, body, placement);
    return handle;
  }

  /** Moves a squishy (e.g. after it walks to another tile). */
  move(handle: SquishyHandle, placement: SquishyPlacement): void {
    const squishy = this.#squishies.get(handle.id);
    const body = this.#registry.bodies.get(handle.params.body.id);
    if (!squishy || !body) return;
    this.#detach(squishy);
    this.#layout(squishy, body, placement);
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
    return { squishies: this.#squishies.size, meshes, instances, shadowLook, lod: this.#lod };
  }

  /** Uploads changed instance buffers. Runs before every render; call it to force one. */
  flush(): void {
    for (const batch of this.#batches.values()) {
      if (batch.dirty) this.#upload(batch);
    }
    if (this.#shadowDirty) this.#uploadShadows();
  }

  dispose(): void {
    if (this.#beforeRender) this.#scene.onBeforeRenderObservable.remove(this.#beforeRender);
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
      batch = { key, build, pickable, instances: [], mesh: null, dirty: true };
      this.#batches.set(key, batch);
    }
    return batch;
  }

  #layout(squishy: Squishy, body: Body, placement: SquishyPlacement): void {
    const { params } = squishy.handle;
    const scale = placement.scale ?? 1;
    const ground = new Vector3(placement.x, placement.y ?? 0, placement.z);
    squishy.world = Matrix.Compose(
      new Vector3(scale, scale, scale),
      Quaternion.RotationAxis(Vector3.Up(), placement.yaw ?? 0),
      ground,
    );
    squishy.origin = [ground.x, ground.y, ground.z, params.height * scale];

    const shadow = squishy.handle.look === 'shadow';
    const attach = (batch: Batch, local: Matrix, color: Instance['color'], eyes = false) => {
      const look = !shadow
        ? SQUISH_LOOK_CODE.normal
        : eyes
          ? SQUISH_LOOK_CODE.shadowEyes
          : SQUISH_LOOK_CODE.shadow;
      const instance: Instance = {
        owner: squishy,
        matrix: local.multiply(squishy.world),
        // Without the shader (opt-in WebGPU) the look is baked into the colour.
        color: shadow && !this.#plugin ? shadowColor(color, eyes) : color,
        look,
      };
      batch.instances.push(instance);
      batch.dirty = true;
      squishy.instances.push({ batch, instance });
    };

    const bodyBatch = this.#batch(
      `body:${body.id}`,
      (lod) => orientTriangles(bodyArrays(body, LOD[lod].bodyRings)),
      true,
    );
    const [sx, sy, sz] = params.body.scale;
    attach(bodyBatch, Matrix.Scaling(sx, sy, sz), linear(params.body.color));

    for (const part of params.parts) {
      const batch = this.#batch(
        `part:${part.shape}`,
        (lod) => partArrays(part.shape, LOD[lod]),
        false,
      );
      const color = linear(part.color);
      for (const p of part.placements) {
        const local = Matrix.FromArray(partMatrix(body, params.body.scale, part, p));
        attach(batch, local, color, part.slot === 'eyes');
      }
    }
    this.#shadowDirty = true;
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
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceSetBuffer('squishOrigin', origins, 4, true);
    mesh.thinInstanceSetBuffer('squishMotion', motions, 4, true);
    mesh.thinInstanceSetBuffer('squishEvent', events, 4, false);
    if (batch.pickable) mesh.thinInstanceRefreshBoundingInfo();
  }

  #uploadShadows(): void {
    this.#shadowDirty = false;
    const shadow = this.#shadow;
    if (!shadow) return;
    const n = this.#squishies.size;
    shadow.setEnabled(n > 0);
    if (n === 0) return;
    const matrices = new Float32Array(n * 16);
    const rot = Quaternion.Identity();
    let i = 0;
    for (const s of this.#squishies.values()) {
      const body = this.#registry.bodies.get(s.handle.params.body.id);
      const [sx, , sz] = s.handle.params.body.scale;
      const scale = s.world.m[5] ?? 1; // uniform placement scale
      const d =
        Math.max((body?.width ?? 1) * sx, (body?.depth ?? 1) * sz) * scale * CONTACT_SHADOW.scale;
      Matrix.Compose(
        new Vector3(d, 1, d),
        rot,
        new Vector3(s.origin[0], s.origin[1] + 0.01, s.origin[2]),
      ).copyToArray(matrices, i * 16);
      i++;
    }
    shadow.thinInstanceSetBuffer('matrix', matrices, 16, false);
  }
}
