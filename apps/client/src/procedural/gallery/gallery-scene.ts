import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { ClothingItem, VisualRegistry } from '@heartpatch/shared';
import type { SceneContent } from '../../engine/stage.js';
import type { SquishyLod } from '../config.js';
import type { SquishySpecies } from '../params.js';
import { SquishyField } from '../squishy-field.js';

export interface GalleryOptions {
  readonly looks: readonly SquishySpecies[];
  /** How many squishies; looks repeat (with new instance ids) past the end. */
  readonly count: number;
  readonly lod: SquishyLod;
  readonly breathing: boolean;
  /** Extra scale (close-up view). */
  readonly scale: number;
  /** Heading for every squishy, radians. */
  readonly yaw: number;
  /** Every squishy as a rescue guardian from the Hollow (`?shadow`, owner decision 7). */
  readonly shadow?: boolean;
  /** Wardrobe accessories, one per squishy in turn (`?accessory=`, #340). */
  readonly accessories?: readonly ClothingItem[];
  /** Lowers the floor and squishies (world units), so the camera looks at their middles. */
  readonly drop?: number;
}

/** Tile spacing between squishies, in world units at scale 1. */
const SPACING = 2.4; // TUNE

/**
 * A soft pastel floor with squishies in a grid, nearest first. Each
 * squishy's instance id is `gallery-<n>`, so a look shown twice differs a
 * little, as two squishies of one species would.
 */
export function buildGalleryScene(
  scene: Scene,
  registry: VisualRegistry,
  options: GalleryOptions,
): { content: SceneContent; field: SquishyField } {
  scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
  const field = new SquishyField(scene, {
    registry,
    lod: options.lod,
    breathing: options.breathing,
  });

  const spacing = SPACING * options.scale;
  const columns = Math.max(1, Math.ceil(Math.sqrt(options.count)));
  const rows = Math.ceil(options.count / columns);
  for (let i = 0; i < options.count; i++) {
    const look = options.looks[i % options.looks.length];
    if (!look) break;
    const col = i % columns;
    const row = Math.floor(i / columns);
    const handle = field.add(
      look,
      `gallery-${i}`,
      {
        x: (col - (columns - 1) / 2) * spacing,
        z: (row - (rows - 1) / 2) * spacing,
        y: -(options.drop ?? 0),
        scale: options.scale,
        yaw: options.yaw,
      },
      options.shadow ? 'shadow' : 'normal',
    );
    const worn = options.accessories?.[i % options.accessories.length];
    if (worn) field.setAccessory(handle, worn);
  }

  const half = Math.max(columns, rows) * spacing * 0.5 + spacing;
  const floor = CreateCylinder(
    'gallery-floor',
    { diameter: half * 2.6, height: 0.4, tessellation: 96 },
    scene,
  );
  floor.position.y = -0.2 - (options.drop ?? 0);
  const grass = new PBRMaterial('gallery-floor-mat', scene);
  grass.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
  grass.metallic = 0;
  grass.roughness = 0.85;
  floor.material = grass;
  floor.isPickable = false;
  floor.freezeWorldMatrix();

  const r = Math.max(columns, rows) * spacing * 0.5;
  return { content: { bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } }, field };
}
