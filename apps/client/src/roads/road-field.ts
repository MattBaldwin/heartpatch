import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  hexToWorld,
  type HexKey,
  type PublicRoad,
  type PublicTile,
} from '@heartpatch/shared';
import type { MeshArrays } from '../map/hex-mesh.js';
import { HEX_SIZE } from '../map/map-config.js';
import {
  DOME,
  meshFrom,
  overlayMaterial,
  placeAt,
  setInstances,
  TILE_RADIUS,
  topOf,
  vinyl,
} from '../map/map-scene.js';
import { armArrays, clampLevel, hubArrays } from './road-meshes.js';
import { armYaw, maskSides, roadPieces } from './road-layout.js';

// Roads on the map (#621 W1-6): per level one hub mesh and one arm mesh, both
// thin-instanced, so every road on the isle is six draw calls at most (none
// for a level nobody has laid). Plus the ferry's reach tint: one instanced hex
// disc over the far shore. The look comes from `road-meshes.ts`, which
// side joins which from `road-layout.ts`.

const LIFT = DOME + 0.008; // TUNE: a hair above the tile's domed top
const FERRY_LIFT = 0.02; // TUNE
const FERRY_FILL = [0.1, 0.78, 0.95, 0.5] as const; // TUNE: a strong watery aqua, unlike any forest
const FERRY_RIM = [0.92, 1, 1, 0.95] as const; // TUNE: a pale rim, so each far-shore tile has an edge
const FERRY_INSET = 0.94; // TUNE: of the tile's radius
const FERRY_RIM_WIDTH = 0.16; // TUNE: of the tile's radius

/** Mesh arrays that always carry vertex colours. */
export type ColouredMesh = MeshArrays & { colors: number[] };

/** A flat hex disc on y = 0, one flat colour (pointy-top, like the tiles). */
export function hexDisc(radius: number, rgba: readonly number[]): ColouredMesh {
  const positions = [0, 0, 0];
  const colors = [...rgba];
  const indices: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    positions.push(radius * Math.cos(a), 0, radius * Math.sin(a));
    colors.push(...rgba);
    indices.push(0, 1 + ((i + 1) % 6), 1 + i);
  }
  return { positions, indices, colors };
}

/** A hex disc with a rim ring round it (still one mesh, one draw call for every tile). */
export function hexRimDisc(
  radius: number,
  rimWidth: number,
  fill: readonly number[],
  rim: readonly number[],
): ColouredMesh {
  const disc = hexDisc(radius - rimWidth, fill);
  const positions = [...disc.positions];
  const colors = [...disc.colors];
  const indices = [...disc.indices];
  const base = positions.length / 3;
  const inner = radius - rimWidth;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    positions.push(inner * Math.cos(a), 0, inner * Math.sin(a));
    positions.push(radius * Math.cos(a), 0, radius * Math.sin(a));
    colors.push(...rim, ...rim);
  }
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const [a0, b0, a1, b1] = [base + 2 * i, base + 2 * i + 1, base + 2 * j, base + 2 * j + 1];
    indices.push(a0, a1, b1, a0, b1, b0);
  }
  return { positions, indices, colors };
}

/** How many draw calls and instances the field has now (the dev hook). */
export interface RoadFieldStats {
  /** Roads drawn, by level (index 0 is level 1). */
  readonly roads: readonly [number, number, number];
  readonly arms: number;
  readonly ferry: number;
}

export class RoadField {
  private readonly hubs: Mesh[];
  private readonly arms: Mesh[];
  private readonly ferry: Mesh;
  private stats: RoadFieldStats = { roads: [0, 0, 0], arms: 0, ferry: 0 };

  constructor(scene: Scene) {
    const material = vinyl(scene, 'road-mat', { color: '#ffffff' });
    material.roughness = 0.55;
    material.backFaceCulling = false;
    const make = (name: string, arrays: MeshArrays): Mesh => {
      const mesh = meshFrom(scene, name, arrays);
      mesh.material = material;
      mesh.setEnabled(false);
      return mesh;
    };
    this.hubs = [1, 2, 3].map((level) => make(`road-hub-${String(level)}`, hubArrays(level)));
    this.arms = [1, 2, 3].map((level) => make(`road-arm-${String(level)}`, armArrays(level)));
    this.ferry = meshFrom(
      scene,
      'ferry-reach',
      hexRimDisc(TILE_RADIUS * FERRY_INSET, TILE_RADIUS * FERRY_RIM_WIDTH, FERRY_FILL, FERRY_RIM),
    );
    const tint = overlayMaterial(scene, 'ferry-reach-mat');
    tint.backFaceCulling = false;
    this.ferry.material = tint;
    this.ferry.setEnabled(false);
  }

  /**
   * Draws `roads`: each tile's hub, and an arm to every side that joins
   * another road or one of `joins` (bridges and docks, which a road meets
   * end on).
   */
  drawRoads(
    roads: readonly PublicRoad[],
    tiles: ReadonlyMap<HexKey, PublicTile>,
    joins: Iterable<HexKey>,
  ): void {
    const hubs: Matrix[][] = [[], [], []];
    const arms: Matrix[][] = [[], [], []];
    const turn = new Quaternion();
    const one = new Vector3(1, 1, 1);
    // Only roads on tiles we know: a road on a tile the view dropped isn't drawn.
    const known = roads.filter((r) => tiles.has(hexKey(r)));
    for (const piece of roadPieces(known, joins)) {
      const tile = tiles.get(hexKey(piece));
      if (!tile) continue;
      const p = hexToWorld(piece, HEX_SIZE);
      const y = topOf(tile) + LIFT;
      const i = clampLevel(piece.level) - 1;
      hubs[i]?.push(placeAt(p.x, y, p.z));
      for (const side of maskSides(piece.mask)) {
        Quaternion.RotationYawPitchRollToRef(armYaw(side), 0, 0, turn);
        arms[i]?.push(Matrix.Compose(one, turn.clone(), new Vector3(p.x, y, p.z)));
      }
    }
    this.hubs.forEach((mesh, i) => {
      setInstances(mesh, hubs[i] ?? [], true);
    });
    this.arms.forEach((mesh, i) => {
      setInstances(mesh, arms[i] ?? [], true);
    });
    this.stats = {
      roads: [hubs[0]?.length ?? 0, hubs[1]?.length ?? 0, hubs[2]?.length ?? 0],
      arms: arms.reduce((n, list) => n + list.length, 0),
      ferry: this.stats.ferry,
    };
  }

  /** Tints these tiles as the ferry's reach (none: off). */
  drawFerry(tiles: readonly PublicTile[]): void {
    setInstances(
      this.ferry,
      tiles.map((t) => {
        const p = hexToWorld(t, HEX_SIZE);
        return placeAt(p.x, topOf(t) + DOME + FERRY_LIFT, p.z);
      }),
      true,
    );
    this.stats = { ...this.stats, ferry: tiles.length };
  }

  get debug(): RoadFieldStats {
    return this.stats;
  }
}
