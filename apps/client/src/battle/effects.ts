import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
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

// Battle effects (owner decision 2026-10-05), drawn cheaply (CLAUDE.md rule
// 8): one unlit, thin-instanced mesh per particle shape, all built when the
// scene is built, with instance buffers sized once. Spawning a burst only
// fills slots; each frame copies the live particles' matrices and colours
// into the same buffers (no meshes, materials, particle systems or arrays
// made mid-turn). A shape with nothing live is switched off, so effects
// cost no draw calls between hits. The cores are pushed past white so the
// stage's bloom picks them up (Lantern Hour's glow).

/** Most particles of one shape alive at once; extra spawns replace the oldest. */
export const POOL_SIZE: Readonly<Record<ParticleShape, number>> = {
  puff: 120, // TUNE
  halo: 96, // TUNE
  shard: 80, // TUNE
  leaf: 60, // TUNE
  star: 72, // TUNE
  heart: 24, // TUNE
  ring: 6, // TUNE
  line: 40, // TUNE
  drop: 60, // TUNE
};

/** How far past white the cores are pushed, so bloom catches them. */
const GLOW = 1.35; // TUNE

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

function mergeOrThrow(name: string, parts: Mesh[]): Mesh {
  const mesh = Mesh.MergeMeshes(parts, true, true);
  if (!mesh) throw new Error(`could not build ${name}`);
  mesh.name = name;
  return mesh;
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
      return CreateSphere('fx-puff', { diameter: 1, segments: 7 }, scene);
    case 'halo':
      return CreateSphere('fx-halo', { diameter: 1, segments: 6 }, scene);
    case 'shard':
      return bake(CreatePolyhedron('fx-shard', { type: 1, size: 0.5 }, scene), 0.7, 1.5, 0.7);
    case 'leaf':
      return bake(CreateSphere('fx-leaf', { diameter: 1, segments: 6 }, scene), 1, 0.18, 0.55);
    case 'drop': {
      const tip = CreateCylinder(
        'fx-drop-b',
        { height: 0.7, diameterTop: 0, diameterBottom: 0.78, tessellation: 10 },
        scene,
      );
      tip.position.y = 0.45;
      return mergeOrThrow('fx-drop', [
        CreateSphere('fx-drop-a', { diameter: 0.8, segments: 7 }, scene),
        tip,
      ]);
    }
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
    case 'ring':
      return CreateTorus('fx-ring', { diameter: 1, thickness: 0.12, tessellation: 28 }, scene);
    case 'line': {
      // A tapered streak of unit length along +x, from the origin outwards.
      const m = CreatePolyhedron('fx-line', { type: 1, size: 0.5 }, scene);
      m.rotation.z = Math.PI / 2;
      m.bakeCurrentTransformIntoVertices();
      m.position.x = 0.5;
      m.bakeCurrentTransformIntoVertices();
      return m;
    }
  }
}

function hidden(out: Float32Array, i: number): void {
  out.fill(0, i * 16, i * 16 + 16);
  out[i * 16 + 15] = 1;
}

interface Axis {
  x: number;
  y: number;
  z: number;
}

export class EffectPool {
  readonly #pools = new Map<ParticleShape, Pool>();
  readonly #material: StandardMaterial;
  readonly #colors = new Map<string, readonly [number, number, number]>();
  readonly #state: ParticleState = {
    x: 0,
    y: 0,
    z: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    yaw: 0,
    tumble: 0,
    billboard: false,
    roll: 0,
  };
  readonly #camRight: Axis = { x: 1, y: 0, z: 0 };
  readonly #camUp: Axis = { x: 0, y: 1, z: 0 };
  readonly #camFwd: Axis = { x: 0, y: 0, z: 1 };
  #spawned = 0;

  constructor(scene: Scene) {
    const m = new StandardMaterial('fx-mat', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.emissiveColor = new Color3(GLOW, GLOW, GLOW);
    m.specularColor = Color3.Black();
    m.fogEnabled = false;
    m.freeze();
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
      hidden(pool.matrices, 0);
      mesh.thinInstanceSetBuffer('matrix', pool.matrices, 16, false);
      mesh.thinInstanceSetBuffer('color', pool.colors, 4, false);
      mesh.thinInstanceCount = 1;
      mesh.setEnabled(false);
      this.#pools.set(shape, pool);
    }
  }

  /** The camera's basis, for billboarded lines (speed lines, rays). */
  setCamera(right: Vector3, up: Vector3, forward: Vector3): void {
    this.#camRight.x = right.x;
    this.#camRight.y = right.y;
    this.#camRight.z = right.z;
    this.#camUp.x = up.x;
    this.#camUp.y = up.y;
    this.#camUp.z = up.z;
    this.#camFwd.x = forward.x;
    this.#camFwd.y = forward.y;
    this.#camFwd.z = forward.z;
  }

  spawn(particles: readonly Particle[]): void {
    this.#spawned += 1;
    for (const p of particles) {
      const pool = this.#pools.get(p.shape);
      if (!pool) continue;
      if (pool.count === pool.live.length) {
        pool.live.copyWithin(0, 1);
        pool.count -= 1;
      }
      pool.live[pool.count] = p;
      pool.count += 1;
    }
  }

  clear(): void {
    for (const pool of this.#pools.values()) {
      pool.live.fill(null);
      pool.count = 0;
      pool.mesh.setEnabled(false);
    }
  }

  /** Writes every live particle at `now` into the instance buffers; true while any is alive. */
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
        if (!particleAt(p, now, s)) continue;
        this.#write(pool.matrices, drawn, s, p);
        const c = this.#color(p.color);
        pool.colors[drawn * 4] = c[0];
        pool.colors[drawn * 4 + 1] = c[1];
        pool.colors[drawn * 4 + 2] = c[2];
        drawn++;
      }
      for (let i = keep; i < pool.count; i++) pool.live[i] = null;
      pool.count = keep;
      if (keep > 0) alive = true;
      const on = drawn > 0;
      if (on) {
        pool.mesh.thinInstanceCount = drawn;
        pool.mesh.thinInstanceBufferUpdated('matrix');
        pool.mesh.thinInstanceBufferUpdated('color');
      }
      if (pool.mesh.isEnabled() !== on) pool.mesh.setEnabled(on);
    }
    return alive;
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

  #write(out: Float32Array, i: number, s: ParticleState, p: Particle): void {
    const o = i * 16;
    if (s.billboard) {
      // Axes: x along the radial in the camera plane (right·cos + up·sin), y across it, z towards the camera.
      const R = this.#camRight;
      const U = this.#camUp;
      const F = this.#camFwd;
      const c = Math.cos(s.roll);
      const sn = Math.sin(s.roll);
      const axx = R.x * c + U.x * sn;
      const axy = R.y * c + U.y * sn;
      const axz = R.z * c + U.z * sn;
      out[o] = axx * s.sx;
      out[o + 1] = axy * s.sx;
      out[o + 2] = axz * s.sx;
      out[o + 3] = 0;
      out[o + 4] = (-R.x * sn + U.x * c) * s.sy;
      out[o + 5] = (-R.y * sn + U.y * c) * s.sy;
      out[o + 6] = (-R.z * sn + U.z * c) * s.sy;
      out[o + 7] = 0;
      out[o + 8] = F.x * s.sz;
      out[o + 9] = F.y * s.sz;
      out[o + 10] = F.z * s.sz;
      out[o + 11] = 0;
      // The origin plus the radial distance along the line's own axis; rays sit well behind the fight.
      const back = p.motion === 'ray' ? 7 : 0;
      out[o + 12] = p.origin.x + axx * s.x + F.x * back;
      out[o + 13] = p.origin.y + axy * s.x + F.y * back;
      out[o + 14] = p.origin.z + axz * s.x + F.z * back;
      out[o + 15] = 1;
      return;
    }
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    const cx = Math.cos(s.tumble);
    const sx = Math.sin(s.tumble);
    out[o] = cy * s.sx;
    out[o + 1] = 0;
    out[o + 2] = -sy * s.sx;
    out[o + 3] = 0;
    out[o + 4] = sx * sy * s.sy;
    out[o + 5] = cx * s.sy;
    out[o + 6] = sx * cy * s.sy;
    out[o + 7] = 0;
    out[o + 8] = cx * sy * s.sz;
    out[o + 9] = -sx * s.sz;
    out[o + 10] = cx * cy * s.sz;
    out[o + 11] = 0;
    out[o + 12] = s.x;
    out[o + 13] = s.y;
    out[o + 14] = s.z;
    out[o + 15] = 1;
  }
}
