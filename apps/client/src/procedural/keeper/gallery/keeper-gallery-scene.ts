import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { KeeperConfig, KeeperData } from '@heartpatch/shared';
import type { SceneContent } from '../../../engine/stage.js';
import type { SquishyLod } from '../../config.js';
import { KeeperField } from '../keeper-field.js';
import type { KeeperItem } from '../keeper-items.js';

export interface KeeperGalleryOptions {
  readonly configs: readonly KeeperConfig[];
  /** What Keeper `i` wears. */
  readonly items: (i: number) => readonly KeeperItem[];
  readonly lod: SquishyLod;
  /** Extra scale (close-up view). */
  readonly scale: number;
  /** Heading for every Keeper, radians. */
  readonly yaw: number;
  /** Lean back, radians (as in the game, so faces show under its camera). */
  readonly lean: number;
}

/** Spacing between Keepers, in world units at scale 1. */
const SPACING = 2.2; // TUNE

/** A soft pastel floor with Keepers in a grid, the first at the front left. */
export function buildKeeperGalleryScene(
  scene: Scene,
  data: KeeperData,
  options: KeeperGalleryOptions,
): { content: SceneContent; field: KeeperField } {
  scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
  const field = new KeeperField(scene, { data, lod: options.lod });

  const count = options.configs.length;
  const spacing = SPACING * options.scale;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  options.configs.forEach((config, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    field.add(
      config,
      {
        x: (col - (columns - 1) / 2) * spacing,
        z: (row - (rows - 1) / 2) * spacing,
        scale: options.scale,
        yaw: options.yaw,
        lean: options.lean,
      },
      options.items(i),
    );
  });

  const half = Math.max(columns, rows) * spacing * 0.5 + spacing;
  const floor = CreateCylinder(
    'keeper-gallery-floor',
    { diameter: half * 2.6, height: 0.4, tessellation: 96 },
    scene,
  );
  floor.position.y = -0.2;
  const grass = new PBRMaterial('keeper-gallery-floor-mat', scene);
  grass.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
  grass.metallic = 0;
  grass.roughness = 0.85;
  floor.material = grass;
  floor.isPickable = false;
  floor.freezeWorldMatrix();

  const r = Math.max(columns, rows) * spacing * 0.5;
  return { content: { bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } }, field };
}
