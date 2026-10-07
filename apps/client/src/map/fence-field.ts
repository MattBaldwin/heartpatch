import { Quaternion, Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { buildFence, fenceLook } from './fence-props.js';

/** One segment to draw: its look, and where it stands. */
export interface FenceInstance {
  readonly buildingId: string;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface FenceFieldOptions {
  /** Every segment's length (a hex edge, pulled in). */
  readonly length: number;
  readonly material: Material;
  readonly setInstances: (mesh: Mesh, matrices: readonly Matrix[], dynamic?: boolean) => void;
  readonly placeAt: (x: number, y: number, z: number, scale?: Vector3, turn?: Quaternion) => Matrix;
}

/**
 * Fence segments on the map (#203): one thin-instanced mesh per look and
 * level, built the first time one is needed, so a border of any length is a
 * few draw calls. `set` redraws them all from the latest view.
 */
export class FenceField {
  private readonly meshes = new Map<string, Mesh>();
  private drawn = 0;

  private readonly scene: Scene;
  private readonly options: FenceFieldOptions;

  constructor(scene: Scene, options: FenceFieldOptions) {
    this.scene = scene;
    this.options = options;
  }

  /** How many segments are drawn. */
  get count(): number {
    return this.drawn;
  }

  set(fences: readonly FenceInstance[]): void {
    const byKey = new Map<string, FenceInstance[]>();
    for (const f of fences) {
      const key = `${fenceLook(f.buildingId)}:${String(Math.max(1, Math.min(3, f.level)))}`;
      const list = byKey.get(key) ?? [];
      list.push(f);
      byKey.set(key, list);
    }
    for (const key of byKey.keys()) {
      if (this.meshes.has(key)) continue;
      const [look, level] = key.split(':');
      const mesh = buildFence(this.scene, look ?? '', Number(level), this.options.length);
      mesh.material = this.options.material;
      this.meshes.set(key, mesh);
    }
    for (const [key, mesh] of this.meshes) {
      const list = byKey.get(key) ?? [];
      this.options.setInstances(
        mesh,
        list.map((f) =>
          this.options.placeAt(
            f.x,
            f.y,
            f.z,
            Vector3.One(),
            Quaternion.RotationYawPitchRoll(f.yaw, 0, 0),
          ),
        ),
        true,
      );
    }
    this.drawn = fences.length;
  }
}
