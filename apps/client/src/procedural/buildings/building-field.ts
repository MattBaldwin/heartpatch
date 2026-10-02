import { Constants } from '@babylonjs/core/Engines/constants';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { setInstances } from '../../map/map-scene.js';
import { GLOW } from './building-config.js';
import {
  buildBuildingModel,
  modelKey,
  type BuildingLook,
  type BuildingModel,
} from './building-models.js';

// Draws every building in a scene cheaply (CLAUDE.md rule 8): one mesh per
// building look (a lit and an out Hearthfire are two), shared by every
// building of that look and drawn with thin instances, so draw calls grow
// with the kinds of building, not their number. Nothing here animates: a
// still home base never wakes the renderer (tech spec §6). After `set`, the
// caller redraws (`Stage.invalidate`).

export interface BuildingPlacement {
  readonly buildingId: string;
  /** Hearthfires: lit or out. Null for buildings that are never lit. */
  readonly lit: boolean | null;
  readonly x: number;
  readonly z: number;
  /** Ground height. */
  readonly y?: number;
  readonly scale?: number;
  /** Heading in radians; 0 faces −z (towards the default camera). */
  readonly yaw?: number;
}

export interface BuildingFieldStats {
  readonly buildings: number;
  /** Meshes with at least one instance (bodies and glows): the field's draw calls. */
  readonly meshes: number;
  /** Fires drawn lit. */
  readonly lit: number;
}

const lookOf = (p: BuildingPlacement): BuildingLook =>
  p.lit === null ? 'plain' : p.lit ? 'lit' : 'out';

export class BuildingField {
  readonly #scene: Scene;
  readonly #models = new Map<string, BuildingModel>();
  readonly #body: PBRMaterial;
  readonly #glow: StandardMaterial;
  #stats: BuildingFieldStats = { buildings: 0, meshes: 0, lit: 0 };

  constructor(scene: Scene) {
    this.#scene = scene;
    const body = new PBRMaterial('building-vinyl', scene);
    body.albedoColor = Color3.White(); // vertex colours multiply this
    body.metallic = 0;
    body.roughness = 0.45; // TUNE: same soft vinyl as map props
    body.clearCoat.isEnabled = true;
    body.clearCoat.intensity = 0.8;
    body.clearCoat.roughness = 0.2;
    this.#body = body;
    const glow = new StandardMaterial('building-glow', scene);
    glow.disableLighting = true;
    glow.diffuseColor = Color3.Black();
    glow.specularColor = Color3.Black();
    glow.emissiveColor = new Color3(GLOW, GLOW, GLOW); // vertex colours tint it
    glow.alphaMode = Constants.ALPHA_DISABLE;
    this.#glow = glow;
  }

  /** Replaces every building drawn with these. */
  set(placements: readonly BuildingPlacement[]): void {
    const byKey = new Map<string, { buildingId: string; look: BuildingLook; matrices: Matrix[] }>();
    const turn = new Quaternion();
    let lit = 0;
    for (const p of placements) {
      const look = lookOf(p);
      const key = modelKey(p.buildingId, look);
      if (p.lit === true) lit++;
      let group = byKey.get(key);
      if (!group) byKey.set(key, (group = { buildingId: p.buildingId, look, matrices: [] }));
      const list = group.matrices;
      Quaternion.RotationYawPitchRollToRef(p.yaw ?? 0, 0, 0, turn);
      const s = p.scale ?? 1;
      list.push(
        Matrix.Compose(new Vector3(s, s, s), turn.clone(), new Vector3(p.x, p.y ?? 0, p.z)),
      );
    }
    for (const [key, { buildingId, look }] of byKey) {
      if (this.#models.has(key)) continue;
      const model = buildBuildingModel(this.#scene, buildingId, look);
      model.body.material = this.#body;
      if (model.glow) model.glow.material = this.#glow;
      this.#models.set(key, model);
    }
    let meshes = 0;
    for (const [key, model] of this.#models) {
      const matrices = byKey.get(key)?.matrices ?? [];
      for (const mesh of [model.body, model.glow]) {
        if (!mesh) continue;
        setInstances(mesh, matrices, true);
        if (matrices.length > 0) meshes++;
      }
    }
    this.#stats = { buildings: placements.length, meshes, lit };
  }

  get stats(): BuildingFieldStats {
    return this.#stats;
  }

  dispose(): void {
    for (const model of this.#models.values()) {
      model.body.dispose();
      model.glow?.dispose();
    }
    this.#models.clear();
    this.#body.dispose();
    this.#glow.dispose();
  }
}
