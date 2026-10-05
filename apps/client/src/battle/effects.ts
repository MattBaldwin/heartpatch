import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  PARTICLE_SHAPES,
  particleAt,
  type Particle,
  type ParticleShape,
  type ParticleState,
} from './element-fx.js';

// Battle effects (owner decision 2026-10-04), drawn cheaply (CLAUDE.md rule
// 8): one unlit, thin-instanced mesh per particle shape, all built when the
// scene is built, with instance buffers sized once. Spawning a burst only
// fills slots; each frame copies the live particles' matrices and colours
// into the same buffers (no meshes, materials, particle systems or arrays
// made mid-turn). A shape with nothing live is switched off, so effects
// cost no draw calls between hits.

/** Most particles of one shape alive at once; extra spawns replace the oldest. */
export const POOL_SIZE: Readonly<Record<ParticleShape, number>> = {
  puff: 96, // TUNE
  shard: 64, // TUNE
  leaf: 48, // TUNE
  star: 64, // TUNE
  heart: 24, // TUNE
};

interface Pool {
  readonly mesh: Mesh;
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  /** Live particles, oldest first; `count` of them are in use. */
  readonly live: (Particle | null)[];
  count: number;
}

export interface EffectStats {
  /** Particles alive now. */
  readonly live: number;
  /** Effect meshes drawing now (their draw calls). */
  readonly meshes: number;
  /** Bursts spawned in this battle (the dev hook counts them). */
  readonly spawned: number;
}

function buildShape(scene: Scene, shape: ParticleShape): Mesh {
  const bake = (m: Mesh, sx: number, sy: number, sz: number, y = 0): Mesh => {
    m.scaling.set(sx, sy, sz);
    m.position.y = y;
    m.bakeCurrentTransformIntoVertices();
    return m;
  };
  // Unit-sized (about 1 across), so a particle's size is its scale.
  switch (shape) {
    case 'puff':
      return CreateSphere('fx-puff', { diameter: 1, segments: 6 }, scene);
    case 'shard':
      return bake(CreatePolyhedron('fx-shard', { type: 1, size: 0.5 }, scene), 0.7, 1.5, 0.7);
    case 'leaf':
      return bake(CreateSphere('fx-leaf', { diameter: 1, segments: 6 }, scene), 1, 0.2, 0.55);
    case 'star': {
      const a = bake(CreatePolyhedron('fx-star-a', { type: 1, size: 0.5 }, scene), 1.3, 0.38, 0.3);
      const b = bake(CreatePolyhedron('fx-star-b', { type: 1, size: 0.5 }, scene), 0.38, 1.3, 0.3);
      return mergeOrThrow('fx-star', [a, b]);
    }
    case 'heart': {
      const left = CreateSphere('fx-heart-l', { diameter: 0.56, segments: 10 }, scene);
      left.position.set(-0.17, 0.12, 0);
      const right = CreateSphere('fx-heart-r', { diameter: 0.56, segments: 10 }, scene);
      right.position.set(0.17, 0.12, 0);
      const tip = CreateCylinder(
        'fx-heart-tip',
        { height: 0.6, diameterTop: 0.86, diameterBottom: 0, tessellation: 16 },
        scene,
      );
      tip.position.y = -0.2;
      tip.scaling.z = 0.62;
      return mergeOrThrow('fx-heart', [left, right, tip]);
    }
  }
}

function mergeOrThrow(name: string, parts: Mesh[]): Mesh {
  const mesh = Mesh.MergeMeshes(parts, true, true);
  if (!mesh) throw new Error(`could not build ${name}`);
  mesh.name = name;
  return mesh;
}

export class EffectPool {
  readonly #pools = new Map<ParticleShape, Pool>();
  readonly #material: StandardMaterial;
  readonly #colors = new Map<string, readonly [number, number, number]>();
  readonly #state: ParticleState = { x: 0, y: 0, z: 0, scale: 0, yaw: 0, tumble: 0 };
  #spawned = 0;
  #warm = true;

  constructor(scene: Scene) {
    // Unlit: effects stay bright at night, and cost no lighting.
    const m = new StandardMaterial('fx-mat', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.emissiveColor = Color3.White();
    m.specularColor = Color3.Black();
    m.fogEnabled = false;
    this.#material = m;
    for (const shape of PARTICLE_SHAPES) {
      const mesh = buildShape(scene, shape);
      mesh.material = m;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      const cap = POOL_SIZE[shape];
      const pool: Pool = {
        mesh,
        matrices: new Float32Array(cap * 16),
        colors: new Float32Array(cap * 4).fill(1),
        live: new Array<Particle | null>(cap).fill(null),
        count: 0,
      };
      writeHidden(pool.matrices);
      mesh.thinInstanceSetBuffer('matrix', pool.matrices, 16, false);
      mesh.thinInstanceSetBuffer('color', pool.colors, 4, false);
      // Warm-up: one invisible instance each, so every shader compiles while
      // the scene loads instead of on the first hit. Off after the first frame.
      mesh.thinInstanceCount = 1;
      this.#pools.set(shape, pool);
    }
    scene.onAfterRenderObservable.addOnce(() => {
      this.#warm = false;
      for (const pool of this.#pools.values()) {
        if (pool.count === 0) pool.mesh.setEnabled(false);
      }
    });
  }

  /** Adds a burst's particles (each starts drawing at its own `born`). */
  spawn(particles: readonly Particle[]): void {
    this.#spawned += 1;
    for (const p of particles) {
      const pool = this.#pools.get(p.shape);
      if (!pool) continue;
      if (pool.count === pool.live.length) {
        // Full: drop the oldest.
        pool.live.copyWithin(0, 1);
        pool.count -= 1;
      }
      pool.live[pool.count] = p;
      pool.count += 1;
    }
  }

  /** Moves every live particle to `now`; true while any is alive (keep drawing). */
  update(now: number): boolean {
    let alive = false;
    const s = this.#state;
    for (const pool of this.#pools.values()) {
      let keep = 0;
      let drawn = 0;
      for (let i = 0; i < pool.count; i++) {
        const p = pool.live[i];
        if (!p || now >= p.born + p.life) continue;
        pool.live[keep++] = p;
        if (!particleAt(p, now, s)) continue; // not born yet
        writeMatrix(pool.matrices, drawn, s);
        const c = this.#color(p.color);
        pool.colors[drawn * 4] = c[0];
        pool.colors[drawn * 4 + 1] = c[1];
        pool.colors[drawn * 4 + 2] = c[2];
        drawn++;
      }
      for (let i = keep; i < pool.count; i++) pool.live[i] = null;
      pool.count = keep;
      if (keep > 0) alive = true;
      const on = drawn > 0 || this.#warm;
      if (on) {
        pool.mesh.thinInstanceCount = Math.max(1, drawn);
        if (drawn === 0) writeHidden(pool.matrices);
        pool.mesh.thinInstanceBufferUpdated('matrix');
        pool.mesh.thinInstanceBufferUpdated('color');
      }
      if (pool.mesh.isEnabled() !== on) pool.mesh.setEnabled(on);
    }
    return alive;
  }

  /** Clears every effect (a new battle on the same scene). */
  clear(): void {
    for (const pool of this.#pools.values()) {
      pool.live.fill(null);
      pool.count = 0;
      pool.mesh.setEnabled(false);
    }
  }

  get stats(): EffectStats {
    let live = 0;
    let meshes = 0;
    for (const pool of this.#pools.values()) {
      live += pool.count;
      if (pool.mesh.isEnabled()) meshes++;
    }
    return { live, meshes, spawned: this.#spawned };
  }

  dispose(): void {
    for (const pool of this.#pools.values()) pool.mesh.dispose();
    this.#pools.clear();
    this.#material.dispose();
  }

  #color(hex: string): readonly [number, number, number] {
    let c = this.#colors.get(hex);
    if (!c) {
      const linear = Color3.FromHexString(hex).toLinearSpace();
      c = [linear.r, linear.g, linear.b];
      this.#colors.set(hex, c);
    }
    return c;
  }
}

/** A uniform scale, a turn about y and a tumble about x, then the position (Babylon's row-major layout). */
function writeMatrix(out: Float32Array, i: number, s: ParticleState): void {
  const cy = Math.cos(s.yaw);
  const sy = Math.sin(s.yaw);
  const cx = Math.cos(s.tumble);
  const sx = Math.sin(s.tumble);
  const k = s.scale;
  const o = i * 16;
  // Rows are the rotated x, y and z axes (R = Rx(tumble) · Ry(yaw)), scaled.
  out[o] = cy * k;
  out[o + 1] = 0;
  out[o + 2] = -sy * k;
  out[o + 3] = 0;
  out[o + 4] = sx * sy * k;
  out[o + 5] = cx * k;
  out[o + 6] = sx * cy * k;
  out[o + 7] = 0;
  out[o + 8] = cx * sy * k;
  out[o + 9] = -sx * k;
  out[o + 10] = cx * cy * k;
  out[o + 11] = 0;
  out[o + 12] = s.x;
  out[o + 13] = s.y;
  out[o + 14] = s.z;
  out[o + 15] = 1;
}

/** A zero-size instance (the warm-up frame draws nothing visible). */
function writeHidden(out: Float32Array): void {
  out.fill(0, 0, 16);
  out[15] = 1;
}
