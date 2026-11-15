import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import {
  KEEPER_DATA,
  type ClothingItem,
  type KeeperConfig,
  type VisualRegistry,
} from '@heartpatch/shared';
import { KeeperField } from '../keeper/keeper-field.js';
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
  /** One line instead of a square grid (#234 line-ups). */
  readonly row?: boolean;
  /** Gap between looks, world units at scale 1 (default `SPACING`). */
  readonly spacing?: number;
  /** A Keeper at the end of the line, for scale (#234). */
  readonly keeper?: KeeperConfig;
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
): { content: SceneContent; field: SquishyField; keepers: KeeperField | null } {
  scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
  const field = new SquishyField(scene, {
    registry,
    lod: options.lod,
    breathing: options.breathing,
  });

  const spacing = (options.spacing ?? SPACING) * options.scale;
  const slots = options.count + (options.keeper ? 1 : 0);
  const columns = options.row ? slots : Math.max(1, Math.ceil(Math.sqrt(slots)));
  const rows = Math.ceil(slots / columns);
  // In a row line-up the Keeper stands in the middle, squishies either side
  // (#234 compare); in the grid it takes the last tile.
  const keeperSlot = options.row ? Math.floor(slots / 2) : options.count;
  for (let i = 0; i < options.count; i++) {
    const look = options.looks[i % options.looks.length];
    if (!look) break;
    const tile = options.keeper && i >= keeperSlot ? i + 1 : i;
    const col = tile % columns;
    const row = Math.floor(tile / columns);
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

  let keepers: KeeperField | null = null;
  if (options.keeper) {
    const i = keeperSlot;
    keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    keepers.add(options.keeper, {
      x: ((i % columns) - (columns - 1) / 2) * spacing,
      z: (Math.floor(i / columns) - (rows - 1) / 2) * spacing,
      y: -(options.drop ?? 0),
      scale: options.scale,
      yaw: options.yaw,
      lean: 0,
    });
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
  return { content: { bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } }, field, keepers };
}
