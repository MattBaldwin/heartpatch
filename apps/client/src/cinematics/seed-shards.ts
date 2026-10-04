import { Constants } from '@babylonjs/core/Engines/constants';
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { SHARDS } from './cinematic-config.js';

// The Great Scatter's Heart Seeds (shot 5): the Heartpatch breaks and its
// seeds streak away across the sky on long, gentle arcs. One thin-instanced
// mesh, glowing and unlit (one draw call); each shard is a little seed
// stretched along its flight, so it reads as a streak without trails or a
// particle system. Where every shard is is a pure function of time, so the
// player can seek.

export interface Shard {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Velocity, world units a second. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
}

/**
 * Shard `i`, `s` seconds after the burst at `origin`. Directions
 * are spread evenly round the sky (golden-angle steps) and always upwards,
 * so seeds fly out and away, never at the camera's feet.
 */
export function shardAt(i: number, s: number, origin: { x: number; y: number; z: number }): Shard {
  const azimuth = i * 2.399963; // golden angle
  const rise = 0.35 + 0.75 * (((i * 0.618034) % 1) * 0.9 + 0.05); // radians above the horizon
  const [lo, hi] = SHARDS.speed;
  const speed = lo + (hi - lo) * ((i * 0.754877) % 1);
  const flat = Math.cos(rise) * speed;
  const vx = Math.cos(azimuth) * flat;
  const vz = Math.sin(azimuth) * flat;
  const vy0 = Math.sin(rise) * speed;
  const t = Math.max(0, s);
  return {
    x: origin.x + vx * t,
    y: origin.y + vy0 * t - 0.5 * SHARDS.gravity * t * t,
    z: origin.z + vz * t,
    vx,
    vy: vy0 - SHARDS.gravity * t,
    vz,
  };
}

const UP = new Vector3(0, 1, 0);

export class SeedShards {
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  readonly #matrices: Float32Array;
  readonly #scratch = Matrix.Identity();
  readonly #turn = new Quaternion();
  readonly #size = new Vector3();
  readonly #at = new Vector3();
  readonly #dir = new Vector3();
  #uploaded = false;

  /** `imageProcessing`: shards keep their colour through the drain. */
  constructor(scene: Scene, imageProcessing: ImageProcessingConfiguration) {
    this.#mesh = CreateSphere('seed-shard', { diameter: SHARDS.size, segments: 6 }, scene);
    const m = new StandardMaterial('seed-shard-mat', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = Color3.FromHexString(SHARDS.color).toLinearSpace();
    m.imageProcessingConfiguration = imageProcessing;
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    m.alphaMode = Constants.ALPHA_ADD;
    m.disableDepthWrite = true;
    this.#material = m;
    this.#mesh.material = m;
    this.#mesh.isPickable = false;
    this.#mesh.alwaysSelectAsActiveMesh = true;
    this.#matrices = new Float32Array(SHARDS.count * 16);
    this.#mesh.setEnabled(false);
  }

  /** Hides the shards. */
  hide(): void {
    this.#mesh.setEnabled(false);
  }

  /** Draws the burst `s` seconds after it started at `origin`, faded to `glow` (0–1). */
  show(s: number, origin: { x: number; y: number; z: number }, glow: number): void {
    if (glow <= 0.001) {
      this.hide();
      return;
    }
    this.#material.alpha = glow;
    for (let i = 0; i < SHARDS.count; i += 1) {
      const shard = shardAt(i, s, origin);
      const speed = Math.hypot(shard.vx, shard.vy, shard.vz);
      // Stretched along the flight: a streak. Shards start small and grow as they fly out.
      const grow = Math.min(1, 0.3 + s * 1.5);
      this.#size.set(grow, grow, grow * (1 + speed * SHARDS.stretch * 3));
      this.#dir.set(shard.vx, shard.vy, shard.vz).normalize();
      Quaternion.FromLookDirectionLHToRef(this.#dir, UP, this.#turn);
      this.#at.set(shard.x, shard.y, shard.z);
      Matrix.ComposeToRef(this.#size, this.#turn, this.#at, this.#scratch);
      this.#scratch.copyToArray(this.#matrices, i * 16);
    }
    if (this.#uploaded) {
      this.#mesh.thinInstanceBufferUpdated('matrix');
    } else {
      this.#mesh.thinInstanceSetBuffer('matrix', this.#matrices, 16, false);
      this.#uploaded = true;
    }
    this.#mesh.setEnabled(true);
  }
}
