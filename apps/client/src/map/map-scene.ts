import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  hexToWorld,
  worldToHex,
  type Hex,
  type HexKey,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import type { Bounds, GroundPoint } from '../engine/camera/camera-math.js';
import { loftRoundedHex, type MeshArrays, type ProfileRing } from './hex-mesh.js';
import {
  FALLBACK_LOOK,
  HEX_SIZE,
  HOME_LOOK,
  ISLAND,
  PLAYER_COLORS,
  TERRAIN_LOOKS,
  TILE_FILL,
  TINT,
  type PropKind,
  type TerrainLook,
} from './map-config.js';
import {
  findHomeBases,
  mapBounds,
  mapRadius,
  propPlacements,
  slotsByUser,
  tintSlot,
} from './map-layout.js';

// The world map (#7): instanced hex tiles, territory tint, home bases,
// Juniper's Gap and props, drawn from the server's map view. One draw call per
// terrain, per player tint and per prop kind, however many tiles (CLAUDE.md
// rule 8). No textures: soft edges and baked contact shadows are vertex alpha.

const TILE_RADIUS = HEX_SIZE * TILE_FILL;
/** Rounded-top profile shared by tiles and the tint laid over them (top at y = 0). */
const DOME = 0.035; // TUNE
const BEVEL = 0.07; // TUNE
const TOP_RINGS: readonly ProfileRing[] = [
  { scale: 0.5, y: DOME * 0.75 },
  { scale: 0.8, y: DOME * 0.25 },
  { scale: 0.92, y: -BEVEL * 0.25 },
  { scale: 0.98, y: -BEVEL * 0.7 },
  { scale: 1, y: -BEVEL },
];
const CORNER = 0.2; // TUNE: corner rounding, fraction of the radius
const SEGMENTS = 3;
/** Tint floats this far above the tile so it never z-fights. */
const TINT_LIFT = 0.012;
/** Highest a tap can land, for the first guess when picking a tile. */
const PICK_HEIGHT = 0.25;

/** Read-only numbers for the dev hook and tests. */
export interface MapSceneStats {
  readonly tiles: number;
  /** Tiles drawn with a player's tint (home rings included). */
  readonly tinted: number;
  readonly homes: number;
  readonly claimedHomes: number;
  /** Meshes drawing tiles: one per terrain look in use, plus home tiles. */
  readonly tileMeshes: number;
}

function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

function lookOf(tile: PublicTile): TerrainLook {
  if (tile.homeSlot !== null) return HOME_LOOK;
  return TERRAIN_LOOKS[tile.terrain] ?? FALLBACK_LOOK;
}

function vinyl(scene: Scene, name: string, look: TerrainLook | { color: string }): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = linear(look.color);
  m.metallic = 0;
  m.roughness = 'roughness' in look ? look.roughness : 0.45;
  if ('glow' in look && look.glow > 0) m.emissiveColor = linear(look.color).scale(look.glow);
  if (!('clearCoat' in look) || look.clearCoat) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 0.8;
    m.clearCoat.roughness = 0.2;
  }
  return m;
}

/** Unlit, vertex-coloured and alpha-blended: tint, selection and blob shadows. */
function overlayMaterial(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.White();
  m.emissiveColor = Color3.White();
  m.specularColor = Color3.Black();
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.alphaMode = Constants.ALPHA_COMBINE;
  m.disableDepthWrite = true;
  return m;
}

function meshFrom(scene: Scene, name: string, arrays: MeshArrays): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = arrays.positions;
  data.indices = arrays.indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
  data.normals = normals;
  if (arrays.colors) data.colors = arrays.colors;
  data.applyToMesh(mesh);
  if (arrays.colors) mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  // These meshes span the whole map, so culling them saves nothing.
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** Writes instance matrices; a mesh with no instances is switched off (it would draw at the origin). */
function setInstances(mesh: Mesh, matrices: readonly Matrix[], dynamic = false): void {
  if (matrices.length === 0) {
    mesh.thinInstanceSetBuffer('matrix', null);
    mesh.setEnabled(false);
    return;
  }
  const data = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => {
    m.copyToArray(data, i * 16);
  });
  mesh.thinInstanceSetBuffer('matrix', data, 16, !dynamic);
  mesh.setEnabled(true);
}

const NO_TURN = Quaternion.Identity();
const ONE = Vector3.One();

function placeAt(x: number, y: number, z: number, scale = ONE, turn = NO_TURN): Matrix {
  return Matrix.Compose(scale, turn, new Vector3(x, y, z));
}

/** Paints a builder mesh one colour (for merging parts into one vertex-coloured mesh). */
function painted(mesh: Mesh, hex: string): Mesh {
  const c = linear(hex);
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

function merged(name: string, parts: Mesh[]): Mesh {
  const mesh = Mesh.MergeMeshes(parts, true, true);
  if (!mesh) throw new Error(`could not build ${name}`);
  mesh.name = name;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** Procedural vinyl-toy props (design doc §19), one mesh per kind. */
function buildProp(scene: Scene, kind: PropKind): { mesh: Mesh; shadow: number } {
  const at = (m: Mesh, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh => {
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return m;
  };
  const sphere = (d: number) => CreateSphere(`${kind}-part`, { diameter: d, segments: 10 }, scene);
  const cylinder = (h: number, top: number, bottom: number) =>
    CreateCylinder(
      `${kind}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation: 10 },
      scene,
    );
  // TUNE: every size and colour below.
  switch (kind) {
    case 'tree':
      return {
        mesh: merged(kind, [
          painted(at(cylinder(0.18, 0.05, 0.07), 0, 0.09, 0), '#b98a6a'),
          painted(at(sphere(0.28), 0, 0.28, 0, 1, 1.1, 1), '#6cc58a'),
        ]),
        shadow: 0.2,
      };
    case 'old-tree':
      return {
        mesh: merged(kind, [
          painted(at(cylinder(0.24, 0.06, 0.09), 0, 0.12, 0), '#9c7258'),
          painted(at(sphere(0.34), 0, 0.33, 0), '#4f9a72'),
          painted(at(sphere(0.22), 0, 0.5, 0), '#5aa87e'),
        ]),
        shadow: 0.24,
      };
    case 'rock':
      return {
        mesh: merged(kind, [painted(at(sphere(0.22), 0, 0.05, 0, 1.25, 0.7, 1), '#cbbfae')]),
        shadow: 0.18,
      };
    case 'peak':
      return {
        mesh: merged(kind, [
          painted(at(cylinder(0.4, 0.06, 0.42), 0, 0.2, 0), '#a99cc4'),
          painted(at(sphere(0.12), 0, 0.39, 0, 1, 0.7, 1), '#ffffff'),
        ]),
        shadow: 0.28,
      };
    case 'pumpkin':
      return {
        mesh: merged(kind, [
          painted(at(sphere(0.18), 0, 0.07, 0, 1.25, 0.8, 1.25), '#ff9a3c'),
          painted(at(cylinder(0.06, 0.02, 0.03), 0, 0.15, 0), '#6aa84f'),
        ]),
        shadow: 0.16,
      };
  }
}

/**
 * Builds and updates the map in one Babylon scene. Terrain never changes
 * within a map (Phase 1), so tiles are built once; ownership and home bases
 * are redrawn by `update` whenever the map view changes.
 */
export class MapScene {
  readonly bounds: Bounds;
  private readonly scene: Scene;
  private readonly tiles = new Map<HexKey, PublicTile>();
  private readonly tintMeshes: Mesh[] = [];
  private readonly tintMaterial: StandardMaterial;
  private readonly seedMesh: Mesh;
  private readonly plotMesh: Mesh;
  private readonly selection: Mesh;
  private tileMeshes = 0;
  private counts = { tinted: 0, homes: 0, claimedHomes: 0 };

  constructor(scene: Scene, view: MapView) {
    this.scene = scene;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    for (const t of view.tiles) this.tiles.set(hexKey(t), t);
    this.bounds = mapBounds(view.tiles, HEX_SIZE);

    this.buildIsland(view.tiles);
    this.buildTiles(view.tiles);
    this.buildProps(view.tiles);
    this.buildGap();

    this.tintMaterial = overlayMaterial(scene, 'tint-mat');
    this.seedMesh = merged('heart-seed', [
      painted(CreateSphere('seed', { diameter: 0.3, segments: 16 }, scene), '#ff8fb8'),
      painted(
        (() => {
          const leaf = CreateSphere('leaf', { diameter: 0.12, segments: 8 }, scene);
          leaf.position.set(0.05, 0.17, 0);
          leaf.scaling.set(1.4, 0.5, 0.8);
          return leaf;
        })(),
        '#7fd48f',
      ),
    ]);
    const seedMat = vinyl(scene, 'heart-seed-mat', { color: '#ffffff' });
    seedMat.emissiveColor = linear('#ff8fb8').scale(0.35); // TUNE: the Heart Seed glows softly
    this.seedMesh.material = seedMat;
    this.plotMesh = CreateTorus('home-plot', { diameter: 0.34, thickness: 0.05 }, scene);
    this.plotMesh.material = vinyl(scene, 'home-plot-mat', { color: '#f3dcb0' });
    this.plotMesh.isPickable = false;
    this.plotMesh.alwaysSelectAsActiveMesh = true;

    this.selection = meshFrom(
      scene,
      'selection',
      loftRoundedHex(
        TILE_RADIUS,
        [
          { scale: 0.78, y: TINT_LIFT * 2, alpha: 0 },
          { scale: 0.9, y: TINT_LIFT * 2, alpha: 0.95 },
          { scale: 1.02, y: TINT_LIFT * 2, alpha: 0.95 },
          { scale: 1.08, y: TINT_LIFT * 2, alpha: 0 },
        ],
        { corner: CORNER, segments: SEGMENTS, rgb: [1, 1, 1] },
      ),
    );
    this.selection.material = overlayMaterial(scene, 'selection-mat');
    this.selection.alwaysSelectAsActiveMesh = false;
    this.selection.setEnabled(false);

    this.update(view);
  }

  get stats(): MapSceneStats {
    return { tiles: this.tiles.size, tileMeshes: this.tileMeshes, ...this.counts };
  }

  /** Where the camera starts: this player's Heart Seed, else the map centre. */
  homeOf(view: MapView, userId: string | null): GroundPoint {
    const slot = view.members.find((m) => m.user.id === userId)?.homeSlot ?? null;
    const home = findHomeBases(view.tiles).find((h) => h.slot === slot);
    return home ? hexToWorld(home.seed, HEX_SIZE) : { x: 0, z: 0 };
  }

  /** Redraws ownership and home bases from a fresh view of the same map. */
  update(view: MapView): void {
    for (const t of view.tiles) this.tiles.set(hexKey(t), t);
    const slots = slotsByUser(view.members);
    const bySlot = new Map<number, Matrix[]>();
    let tinted = 0;
    for (const tile of this.tiles.values()) {
      const slot = tintSlot(tile, slots);
      if (slot === null) continue;
      const p = hexToWorld(tile, HEX_SIZE);
      let list = bySlot.get(slot);
      if (!list) bySlot.set(slot, (list = []));
      list.push(placeAt(p.x, lookOf(tile).height + TINT_LIFT, p.z));
      tinted++;
    }
    const highest = Math.max(this.tintMeshes.length - 1, ...bySlot.keys());
    for (let slot = 0; slot <= highest; slot++) {
      setInstances(this.tintMesh(slot), bySlot.get(slot) ?? [], true);
    }

    const homes = findHomeBases([...this.tiles.values()]);
    const seeds: Matrix[] = [];
    const plots: Matrix[] = [];
    for (const home of homes) {
      const p = hexToWorld(home.seed, HEX_SIZE);
      if (home.seed.ownerUserId === null) plots.push(placeAt(p.x, HOME_LOOK.height + 0.02, p.z));
      else seeds.push(placeAt(p.x, HOME_LOOK.height + 0.15, p.z));
    }
    setInstances(this.seedMesh, seeds, true);
    setInstances(this.plotMesh, plots, true);
    this.counts = { tinted, homes: homes.length, claimedHomes: seeds.length };
  }

  /** Rings the selected tile, or clears the ring (null). */
  select(h: Hex | null): void {
    const tile = h ? this.tiles.get(hexKey(h)) : undefined;
    if (!tile) {
      this.selection.setEnabled(false);
      return;
    }
    const p = hexToWorld(tile, HEX_SIZE);
    this.selection.position.set(p.x, lookOf(tile).height, p.z);
    this.selection.setEnabled(true);
  }

  /** The tile under a point on the canvas (CSS pixels from its top left), if any. */
  pick(x: number, y: number): PublicTile | null {
    const camera = this.scene.activeCamera;
    if (!camera) return null;
    const ray = CreatePickingRay(this.scene, x, y, null, camera);
    const hit = (height: number): PublicTile | undefined => {
      if (ray.direction.y >= 0) return undefined;
      const t = (height - ray.origin.y) / ray.direction.y;
      const p = { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
      return this.tiles.get(hexKey(worldToHex(p, HEX_SIZE)));
    };
    // Tiles stand at different heights: guess, then look again at that tile's top.
    const first = hit(PICK_HEIGHT);
    if (!first) return null;
    return hit(lookOf(first).height) ?? first;
  }

  private tintMesh(slot: number): Mesh {
    for (let s = this.tintMeshes.length; s <= slot; s++) {
      const color = linear(PLAYER_COLORS[s % PLAYER_COLORS.length] ?? '#ffffff');
      const mesh = meshFrom(
        this.scene,
        `tint-${String(s)}`,
        loftRoundedHex(
          TILE_RADIUS,
          [
            { scale: 0.5, y: DOME * 0.75, alpha: TINT.fill },
            { scale: 0.8, y: DOME * 0.25, alpha: TINT.fill },
            { scale: 0.92, y: -BEVEL * 0.25, alpha: TINT.edge },
            { scale: 0.98, y: -BEVEL * 0.7, alpha: TINT.edge * 0.6 },
            { scale: 1, y: -BEVEL, alpha: 0 },
          ],
          {
            corner: CORNER,
            segments: SEGMENTS,
            centre: { y: DOME, alpha: TINT.fill },
            rgb: [color.r, color.g, color.b],
          },
        ),
      );
      mesh.material = this.tintMaterial;
      mesh.setEnabled(false);
      this.tintMeshes.push(mesh);
    }
    const mesh = this.tintMeshes[slot];
    if (!mesh) throw new Error(`no tint mesh for slot ${String(slot)}`);
    return mesh;
  }

  private buildIsland(tiles: readonly PublicTile[]): void {
    const radius = mapRadius(tiles, HEX_SIZE) + ISLAND.margin;
    const island = CreateCylinder(
      'island',
      { diameter: radius * 2, height: ISLAND.thickness, tessellation: 96 },
      this.scene,
    );
    island.position.y = -ISLAND.thickness / 2;
    const rim = CreateTorus(
      'island-rim',
      { diameter: radius * 2, thickness: ISLAND.thickness, tessellation: 96 },
      this.scene,
    );
    rim.position.y = -ISLAND.thickness / 2;
    const mat = vinyl(this.scene, 'island-mat', {
      ...FALLBACK_LOOK,
      color: ISLAND.color,
      roughness: 0.85,
    });
    for (const m of [island, rim]) {
      m.material = mat;
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
  }

  /** One mesh per terrain look (plus home tiles), each drawing all its tiles at once. */
  private buildTiles(tiles: readonly PublicTile[]): void {
    const groups = new Map<TerrainLook, { key: string; matrices: Matrix[] }>();
    for (const tile of tiles) {
      const look = lookOf(tile);
      let group = groups.get(look);
      if (!group) {
        group = { key: tile.homeSlot !== null ? 'home' : tile.terrain, matrices: [] };
        groups.set(look, group);
      }
      const p = hexToWorld(tile, HEX_SIZE);
      group.matrices.push(placeAt(p.x, 0, p.z));
    }
    for (const [look, { key, matrices }] of groups) {
      const h = look.height;
      const mesh = meshFrom(
        this.scene,
        `tiles-${key}`,
        loftRoundedHex(
          TILE_RADIUS,
          [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
          { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
        ),
      );
      const mat = vinyl(this.scene, `tiles-${key}-mat`, look);
      mat.freeze();
      mesh.material = mat;
      setInstances(mesh, matrices);
      mesh.freezeWorldMatrix();
    }
    this.tileMeshes = groups.size;
  }

  private buildProps(tiles: readonly PublicTile[]): void {
    const byKind = new Map<PropKind, Matrix[]>();
    const shadows: Matrix[] = [];
    const meshes = new Map<PropKind, { mesh: Mesh; shadow: number }>();
    const turn = new Quaternion();
    for (const tile of tiles) {
      if (tile.homeSlot !== null) continue;
      const look = lookOf(tile);
      for (const prop of propPlacements(tile, look, HEX_SIZE)) {
        let built = meshes.get(prop.kind);
        if (!built) {
          built = buildProp(this.scene, prop.kind);
          meshes.set(prop.kind, built);
        }
        Quaternion.RotationYawPitchRollToRef(prop.turn, 0, 0, turn);
        const s = new Vector3(prop.scale, prop.scale, prop.scale);
        let list = byKind.get(prop.kind);
        if (!list) byKind.set(prop.kind, (list = []));
        list.push(placeAt(prop.at.x, look.height + DOME * 0.5, prop.at.z, s, turn.clone()));
        const d = built.shadow * prop.scale;
        shadows.push(
          placeAt(prop.at.x, look.height + DOME + 0.004, prop.at.z, new Vector3(d, 1, d)),
        );
      }
    }
    const propMat = vinyl(this.scene, 'prop-mat', { color: '#ffffff' });
    propMat.freeze();
    for (const [kind, { mesh }] of meshes) {
      mesh.material = propMat;
      setInstances(mesh, byKind.get(kind) ?? []);
      mesh.freezeWorldMatrix();
    }

    // Baked soft contact shadows: one round, vertex-alpha disc per prop.
    const shadow = meshFrom(
      this.scene,
      'prop-shadows',
      loftRoundedHex(1, [{ scale: 1, y: 0, alpha: 0 }], {
        corner: Math.sqrt(3) / 2, // fully rounded: a circle
        segments: 6,
        centre: { y: 0, alpha: 0.35 }, // TUNE
        rgb: [0.42, 0.29, 0.43],
      }),
    );
    shadow.material = overlayMaterial(this.scene, 'prop-shadow-mat');
    setInstances(shadow, shadows);
    shadow.freezeWorldMatrix();
  }

  /** Juniper's Gap landmark (design doc §2): a glowing tree on the centre tile. */
  private buildGap(): void {
    const centre = this.tiles.get(hexKey({ q: 0, r: 0 }));
    if (centre?.terrain !== 'junipers-gap') return;
    const h = lookOf(centre).height + DOME * 0.5;
    const part = (m: Mesh, y: number, hex: string, sy = 1): Mesh => {
      m.position.y = y;
      m.scaling.y = sy;
      return painted(m, hex);
    };
    // TUNE: sizes and colours.
    const tree = merged('junipers-gap-tree', [
      part(
        CreateCylinder(
          'trunk',
          { height: 0.5, diameterTop: 0.08, diameterBottom: 0.16 },
          this.scene,
        ),
        0.25,
        '#c9a27e',
      ),
      part(
        CreateSphere('canopy', { diameter: 0.6, segments: 16 }, this.scene),
        0.62,
        '#f3b6ff',
        0.9,
      ),
      part(CreateSphere('crown', { diameter: 0.36, segments: 12 }, this.scene), 0.9, '#ffd1f0'),
    ]);
    tree.position.set(0, h, 0);
    const mat = vinyl(this.scene, 'junipers-gap-tree-mat', { color: '#ffffff' });
    mat.emissiveColor = linear('#f3b6ff').scale(0.4); // TUNE: the glowing valley
    mat.freeze();
    tree.material = mat;
    tree.freezeWorldMatrix();
  }
}
