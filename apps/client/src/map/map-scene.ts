import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
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
  KEEPER_DATA,
  type PublicTile,
  type WorldPoint,
} from '@heartpatch/shared';
import type { Bounds, GroundPoint } from '../engine/camera/camera-math.js';
import { MAP_BUILDING_SCALE, SAFE_GLOW } from '../home/home-config.js';
import { mapBuildings, mapSafeTiles } from '../home/home-layout.js';
import { BuildingField } from '../procedural/buildings/building-field.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { KeeperField } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { AmbientJudge, ambientMode, moteShare, type AmbientMode } from './ambient-layout.js';
import { loftRoundedHex, type MeshArrays, type ProfileRing } from './hex-mesh.js';
import { MapAmbient, type AmbientStats } from './map-ambient.js';
import {
  AMBIENT,
  CLAIMED,
  CRYSTAL_GLOW,
  FALLBACK_LOOK,
  GROUND,
  HALLOWEEN,
  HEX_SIZE,
  HOME_LOOK,
  ISLAND,
  MAP_LIGHT,
  PATHS,
  PLAYER_COLORS,
  PROP_SWAY,
  TERRAIN_LOOKS,
  TILE_FILL,
  WATER,
  type PropKind,
  type TerrainLook,
} from './map-config.js';
import {
  clutterTile,
  dressTile,
  flourishTile,
  hexRgb,
  tileColor,
  tileJitter,
  type DressingPlacement,
} from './map-dressing.js';
import { Ground, type Rgb } from './ground-mesh.js';
import {
  hexOverlay,
  homePaths,
  joinArrays,
  pathRibbon,
  territoryBorder,
  type Surface,
} from './ground-overlay.js';
import { waterMesh } from './water-mesh.js';
import {
  findHomeBases,
  hash01,
  mapBounds,
  mapRadius,
  slotsByUser,
  tintSlot,
} from './map-layout.js';
import { buildProp, linear, merged, painted, type BuiltProp } from './map-props.js';
import {
  AMBIENT_ATTRIBUTE,
  attachTerrainPlugin,
  SHORE_ATTRIBUTE,
  TerrainClock,
} from './terrain-plugin.js';
import type { QualityTier } from '../engine/config.js';

// Prop builders moved to map-props.ts; re-exported here, where other screens
// (home, cinematic, battle) import them from.
export { buildProp, merged, painted, type BuiltProp } from './map-props.js';

// The world map (#7), drawn from the server's map view: one continuous ground
// (terrain pass 2: no hex pucks), lakes' water, territory glows and borders,
// home bases, Juniper's Gap, props in clumps, ground clutter, paths, and
// ambient life. One draw call per prop kind, however many tiles (CLAUDE.md
// rule 8). No textures: colour and soft edges are vertex colour and alpha.
// Everything that moves does so on the GPU from one time uniform
// (terrain-plugin.ts).

/** Rounded-top hex tile profile, still used by Home and the cinematic (top at y = 0). */
export const DOME = 0.035; // TUNE
export const BEVEL = 0.07; // TUNE
export const TOP_RINGS: readonly ProfileRing[] = [
  { scale: 0.5, y: DOME * 0.75 },
  { scale: 0.8, y: DOME * 0.25 },
  { scale: 0.92, y: -BEVEL * 0.25 },
  { scale: 0.98, y: -BEVEL * 0.7 },
  { scale: 1, y: -BEVEL },
];
export const CORNER = 0.2; // TUNE: corner rounding, fraction of the radius
export const SEGMENTS = 3;
/** Contact shadows only under props at least this wide (diameter, world units). */
const MIN_SHADOW = 0.15; // TUNE
/** #117's tile locator measures tiles at this radius. */
const TILE_RADIUS = HEX_SIZE * TILE_FILL;
/** Overlays (territory, selection, safe glow, paths) float this far above the ground so they never z-fight. */
const OVERLAY_LIFT = 0.012;
/** The selection ring: a bright band just inside the tile's edge. */
const SELECTION_RINGS = [
  { scale: 0.8, alpha: 0 },
  { scale: 0.9, alpha: 0.95 },
  { scale: 0.99, alpha: 0.95 },
  { scale: 1.05, alpha: 0 },
] as const;

/** Highest a tap can land, for the first guess when picking a tile. */
const PICK_HEIGHT = 0.25;

/** Read-only numbers for the dev hook and tests. */
export interface MapSceneStats {
  readonly tiles: number;
  /** Resource-node props on home bases (Timber trees, Stone rocks…). */
  readonly homeNodes: number;
  /** Tiles drawn with a player's tint (home rings included). */
  readonly tinted: number;
  readonly homes: number;
  readonly claimedHomes: number;
  /** Meshes drawing tiles: the one continuous ground. */
  readonly tileMeshes: number;
  /** Keepers standing at their home bases (#42). */
  readonly keepers: number;
  /** Buildings on home bases (#18), and the Hearthfires among them drawn lit. */
  readonly buildings: number;
  readonly litFires: number;
  /** Tiles under a lit Hearthfire's soft glow (its safe radius, #18). */
  readonly safeTiles: number;
  /** Clothing ids each drawn Keeper wears (#43), by drawing order. */
  readonly keepersWearing: readonly (readonly string[])[];
  /** Dressing props on the map, and how many kinds (one draw call each). */
  readonly props: number;
  readonly propKinds: number;
  /** Ground clutter drawn (tufts, clover, pebbles, petals): a share on lower tiers. */
  readonly clutter: number;
  /** Claimed-land flourishes (lanterns, flowers). */
  readonly flourishes: number;
  /** Halloween dressing is on (season, map-local date). */
  readonly halloween: boolean;
  readonly night: boolean;
  /** Ambient life: `live`, `still` (reduced motion) or `off` (low tier or a slow device). */
  readonly ambient: AmbientMode;
  readonly motes: AmbientStats['motes'];
}

export interface MapSceneOptions {
  /** Halloween is on for this map (shared `activeSeasons`, map-local date). */
  readonly halloween?: boolean;
  /** The quality tier and reduced motion to start with (`setAmbient` follows changes). */
  readonly tier?: QualityTier;
  readonly reducedMotion?: boolean;
}

function lookOf(tile: PublicTile): TerrainLook {
  if (tile.homeSlot !== null) return HOME_LOOK;
  return TERRAIN_LOOKS[tile.terrain] ?? FALLBACK_LOOK;
}

/** sRGB (0–1) to linear, as Babylon's `toLinearSpace` does. */
const toLinear = (v: number): number => Math.pow(v, 2.2);

/** A linear-RGB colour from sRGB hex. */
const rgbOf = (hex: string): Rgb => {
  const [r, g, b] = hexRgb(hex).map(toLinear);
  return [r ?? 0, g ?? 0, b ?? 0];
};

/** Height of a tile's flat middle in the ground: its look's plus its wobble; a lake's bed; home flat. */
function groundHeightOf(tile: PublicTile): number {
  if (tile.homeSlot !== null) return HOME_LOOK.height;
  if (tile.terrain === 'lake') return GROUND.lakeBed;
  return lookOf(tile).height + tileJitter(tile, tile.terrain).height;
}

/** A tile's ground colour (linear): the map's own palette, wobbled a little per tile. */
function groundColorOf(tile: PublicTile): Rgb {
  if (tile.homeSlot !== null) return rgbOf(GROUND.home);
  const hex = GROUND.colors[tile.terrain] ?? GROUND.colors['meadow'] ?? '#8fcf63';
  const [r, g, b] = tileColor(hex, tileJitter(tile, tile.terrain)).map(toLinear);
  return [r ?? 0, g ?? 0, b ?? 0];
}

/** Height a tile's things stand on: the water's surface on a lake, else its ground. */
function topOf(tile: PublicTile): number {
  return tile.terrain === 'lake' && tile.homeSlot === null ? WATER.level : groundHeightOf(tile);
}

/** The ground, with the water's surface over lakes: what props and overlays stand on. */
function surfaceOver(ground: Ground, tiles: ReadonlyMap<HexKey, PublicTile>): Surface {
  const lake = (h: Hex) => {
    const t = tiles.get(hexKey(h));
    return t !== undefined && t.terrain === 'lake' && t.homeSlot === null;
  };
  return {
    heightAt: (p) => {
      const y = ground.heightAt(p);
      if (y === null) return null;
      return lake(worldToHex(p, HEX_SIZE)) ? Math.max(y, WATER.level) : y;
    },
    tileHeight: (h) => (lake(h) ? WATER.level : ground.tileHeight(h)),
  };
}

export function vinyl(
  scene: Scene,
  name: string,
  look: TerrainLook | { color: string },
): PBRMaterial {
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
export function overlayMaterial(scene: Scene, name: string): StandardMaterial {
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

export function meshFrom(scene: Scene, name: string, arrays: MeshArrays): Mesh {
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
export function setInstances(mesh: Mesh, matrices: readonly Matrix[], dynamic = false): void {
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

export function placeAt(x: number, y: number, z: number, scale = ONE, turn = NO_TURN): Matrix {
  return Matrix.Compose(scale, turn, new Vector3(x, y, z));
}

/** The Heart Seed (design doc §11): a softly glowing pink seed with a leaf. Diameter 0.3. */
export function buildHeartSeed(scene: Scene): Mesh {
  const mesh = merged('heart-seed', [
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
  const mat = vinyl(scene, 'heart-seed-mat', { color: '#ffffff' });
  mat.emissiveColor = linear('#ff8fb8').scale(0.35); // TUNE: the Heart Seed glows softly
  mesh.material = mat;
  return mesh;
}

/**
 * Builds and updates the map in one Babylon scene. Terrain never changes
 * within a map (Phase 1), so the ground, water and dressing are built once;
 * ownership, home bases and claimed-land flourishes are redrawn by `update`
 * whenever the map view changes.
 */
export class MapScene {
  readonly bounds: Bounds;
  private readonly scene: Scene;
  private readonly tiles = new Map<HexKey, PublicTile>();
  /** The continuous ground (terrain pass 2) and the surface overlays and props stand on. */
  private readonly ground: Ground;
  private readonly surface: Surface;
  private readonly overlayMat: StandardMaterial;
  /** Each slot's territory glow and border, rebuilt when its land changes. */
  private readonly territory = new Map<number, { key: string; mesh: Mesh }>();
  private readonly seedMesh: Mesh;
  private readonly plotMesh: Mesh;
  private selection: Mesh | null = null;
  /** Each member's Keeper by their Heart Seed (design doc §23). Low detail; never animates here. */
  private readonly keepers: KeeperField;
  /** Fires and habitats on home bases (#18), at map scale. */
  private readonly buildings: BuildingField;
  /** The soft glow over tiles a lit Hearthfire keeps safe (#18), rebuilt when that set changes. */
  private safeGlow: { key: string; mesh: Mesh | null } = { key: '', mesh: null };
  /** The player's home node the tutorial points at (`homeNodeRect`), until `update`. */
  private homeNode: { userId: string | null; tile: PublicTile | null } | null = null;
  /** Resource nodes drawn on home bases (`buildHomeNodes`). */
  private readonly homeNodes: number;
  private counts = { tinted: 0, homes: 0, claimedHomes: 0, safeTiles: 0, flourishes: 0 };
  /** Ambient time: every terrain material reads it (terrain-plugin.ts). */
  private readonly clock = new TerrainClock();
  private readonly halloween: boolean;
  private propCount = 0;
  private propKinds = 0;
  /** Ground clutter meshes and their full instance counts (a tier draws a share). */
  private readonly clutter: { mesh: Mesh; count: number }[] = [];
  /** Claimed-land flourishes (lanterns, flowers), one mesh per kind, refilled by `update`. */
  private readonly flourishes = new Map<PropKind, Mesh>();
  /** Glowing props whose glow changes at night (jack-o'-lanterns, claimed lanterns). */
  private lanternMat: PBRMaterial | null = null;
  private claimedLanternMat: PBRMaterial | null = null;
  private readonly ambient: MapAmbient;
  /** False under WebGPU: the terrain plugin is GLSL only, so nothing moves there. */
  private readonly animated: boolean;
  private night = false;
  private mode: AmbientMode = 'live';
  private tier: QualityTier = 'high';
  private share = 1;
  private readonly judge = new AmbientJudge();
  /** Wall-clock ms at ambient-time zero (the first `tick`). */
  private clockStart: number | null = null;

  constructor(scene: Scene, view: MapView, options: MapSceneOptions = {}) {
    this.scene = scene;
    this.halloween = options.halloween === true;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    for (const t of view.tiles) this.tiles.set(hexKey(t), t);
    this.bounds = mapBounds(view.tiles, HEX_SIZE);
    this.warmLight();

    this.ground = new Ground(
      view.tiles.map((t) => ({
        q: t.q,
        r: t.r,
        height: groundHeightOf(t),
        color: groundColorOf(t),
      })),
      { size: HEX_SIZE, plateau: GROUND.plateau, noise: GROUND.noise, skirtTo: GROUND.skirtTo },
    );
    this.surface = surfaceOver(this.ground, this.tiles);
    this.overlayMat = overlayMaterial(scene, 'ground-overlay-mat');
    // Overlays lie on slopes either way up; draw both faces.
    this.overlayMat.backFaceCulling = false;

    this.buildIsland(view.tiles);
    this.buildGround(view.tiles);
    // Under WebGPU the terrain plugin isn't attached (GLSL only): nothing moves.
    this.propMat();
    this.animated = this.propPlugin !== null;
    this.buildProps(view.tiles);
    this.buildClutter(view.tiles);
    this.buildPaths(view.tiles);
    this.homeNodes = buildHomeNodes(scene, view.tiles);
    this.buildGap();
    this.ambient = new MapAmbient(scene, view.tiles, this.clock, {
      halloween: this.halloween,
      islandRadius: mapRadius(view.tiles, HEX_SIZE) + ISLAND.margin,
    });
    // Start as the tier and motion setting say, so nothing shows for a frame
    // that would then be hidden (drifting motes under reduced motion).
    this.tier = options.tier ?? 'high';
    this.mode = this.animated
      ? ambientMode({ tier: this.tier, reducedMotion: options.reducedMotion === true, slow: false })
      : 'off';
    this.share = moteShare(this.tier);

    this.seedMesh = buildHeartSeed(scene);
    this.plotMesh = CreateTorus('home-plot', { diameter: 0.34, thickness: 0.05 }, scene);
    this.plotMesh.material = vinyl(scene, 'home-plot-mat', { color: '#f3dcb0' });
    this.plotMesh.isPickable = false;
    this.plotMesh.alwaysSelectAsActiveMesh = true;

    // No contact shadows: map props have none either, and Keepers are tiny here.
    this.keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: 'low', shadows: false });
    this.buildings = new BuildingField(scene);
    this.update(view);
    this.applyAmbient();
  }

  get stats(): MapSceneStats {
    return {
      tiles: this.tiles.size,
      tileMeshes: 1,
      homeNodes: this.homeNodes,
      ...this.counts,
      keepers: this.keepers.handles.length,
      buildings: this.buildings.stats.buildings,
      litFires: this.buildings.stats.lit,
      keepersWearing: this.keepers.handles.map((h) => h.params.worn),
      props: this.propCount,
      propKinds: this.propKinds,
      clutter: this.clutter.reduce(
        (n, c) => n + (c.mesh.isEnabled() ? c.mesh.thinInstanceCount : 0),
        0,
      ),
      halloween: this.halloween,
      night: this.night,
      ambient: this.mode,
      motes: this.ambient.stats.motes,
    };
  }

  /**
   * How ambient life runs: the quality tier and the player's reduced-motion
   * setting. True when what's drawn changed (draw a frame).
   */
  setAmbient(tier: QualityTier, reducedMotion: boolean): boolean {
    const mode = this.animated
      ? ambientMode({ tier, reducedMotion, slow: this.judge.slow })
      : 'off';
    const share = moteShare(tier);
    if (mode === this.mode && tier === this.tier) return false;
    this.mode = mode;
    this.tier = tier;
    this.share = share;
    this.applyAmbient();
    return true;
  }

  /** How ambient life runs now (cheap: the ambient driver reads it every frame). */
  get ambientMode(): AmbientMode {
    return this.mode;
  }

  /**
   * Moves ambient time to `now` (wall-clock ms). True if the map should draw
   * a frame for it (ambient life is live); the caller paces these.
   */
  tick(now: number): boolean {
    if (this.mode !== 'live') return false;
    if (this.judge.record(now)) {
      // Too slow for ambient life here: everything stands still from now on.
      this.applyAmbient();
      return true;
    }
    this.clockStart ??= now;
    this.clock.time = (now - this.clockStart) / 1000;
    return true;
  }

  /** The page was hidden: the time away isn't a slow frame (`AmbientJudge.skip`). */
  skipPace(): void {
    this.judge.skip();
  }

  /** Night on the map (#21): fireflies instead of pollen, the night backdrop, lanterns glow brighter. */
  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    this.applyAmbient();
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
    this.homeNode = null;
    const slots = slotsByUser(view.members);
    const bySlot = new Map<number, PublicTile[]>();
    let tinted = 0;
    for (const tile of this.tiles.values()) {
      const slot = tintSlot(tile, slots);
      if (slot === null) continue;
      let list = bySlot.get(slot);
      if (!list) bySlot.set(slot, (list = []));
      list.push(tile);
      tinted++;
    }
    // Each territory's warm glow and soft border, rebuilt only when its land changed.
    for (const slot of new Set([...this.territory.keys(), ...bySlot.keys()])) {
      this.drawTerritory(slot, bySlot.get(slot) ?? []);
    }
    const flourishes = this.drawFlourishes([...bySlot.values()].flat());

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

    // A small Keeper beside each claimed Heart Seed, so rivals see who's who.
    this.keepers.clear();
    const place = KEEPER_PLACES.map;
    for (const home of homes) {
      const owner = home.seed.ownerUserId;
      const keeper = view.members.find((m) => m.user.id === owner)?.keeper;
      if (!keeper) continue;
      const p = hexToWorld(home.seed, HEX_SIZE);
      // Dressed in what they wear (#43), so rivals see outfits.
      const { wearing, ...config } = keeper;
      this.keepers.add(
        config,
        {
          x: p.x + place.offset.x,
          z: p.z + place.offset.z,
          y: HOME_LOOK.height,
          scale: place.scale,
          lean: place.lean,
        },
        keeperItems(wearing),
      );
    }
    // Fires and habitats (#18), and the warm glow over tiles a lit fire keeps safe.
    this.buildings.set(
      mapBuildings(view, HEX_SIZE).map(({ tile, building, at }) => ({
        buildingId: building.buildingId,
        lit: building.lit,
        x: at.x,
        z: at.z,
        y: this.surface.heightAt(at) ?? topOf(tile),
        scale: HEX_SIZE * MAP_BUILDING_SCALE,
      })),
    );
    const safe = [...mapSafeTiles(view)]
      .map((key) => this.tiles.get(key))
      .filter((t): t is PublicTile => t !== undefined);
    this.drawSafeGlow(safe);
    this.counts = {
      tinted,
      homes: homes.length,
      claimedHomes: seeds.length,
      safeTiles: safe.length,
      flourishes,
    };
  }

  /** Rings the selected tile (following the ground), or clears the ring (null). */
  select(h: Hex | null): void {
    this.selection?.dispose();
    this.selection = null;
    const tile = h ? this.tiles.get(hexKey(h)) : undefined;
    if (!tile) return;
    this.selection = meshFrom(
      this.scene,
      'selection',
      hexOverlay([tile], this.surface, SELECTION_RINGS, {
        size: HEX_SIZE,
        lift: OVERLAY_LIFT * 2,
        rgb: [1, 1, 1],
      }),
    );
    this.selection.material = this.overlayMat;
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
    return hit(topOf(first)) ?? first;
  }

  /**
   * Where this player's home node is on screen (CSS pixels), for the
   * tutorial's `resource-node` spotlight: their Timber node if they have one,
   * else any node on their home base. Null if it isn't in front of the camera.
   */
  homeNodeRect(userId: string | null): ScreenRect | null {
    // Called every drawn frame while the tutorial follows it: ownership only
    // changes in `update`, so the tile is looked up once per player.
    if (this.homeNode?.userId !== userId) {
      this.homeNode = { userId, tile: homeNodeOf([...this.tiles.values()], userId) };
    }
    const { tile } = this.homeNode;
    return tile ? tileScreenRect(this.scene, tile, lookOf(tile).height) : null;
  }

  /** The map's warm golden light and gentle warm grade (this scene only). */
  private warmLight(): void {
    const sun = this.scene.getLightByName('sun');
    if (sun) {
      sun.diffuse = Color3.FromHexString(MAP_LIGHT.sun);
      sun.intensity *= MAP_LIGHT.sunIntensity;
    }
    const ip = this.scene.imageProcessingConfiguration;
    const curves = new ColorCurves();
    curves.globalSaturation = MAP_LIGHT.saturation;
    curves.highlightsHue = MAP_LIGHT.warmHue;
    curves.highlightsDensity = MAP_LIGHT.warmDensity;
    ip.colorCurves = curves;
    ip.colorCurvesEnabled = true;
  }

  /** A territory's glow and border; rebuilt only when its tiles changed. */
  private drawTerritory(slot: number, owned: readonly PublicTile[]): void {
    const key = owned.map(hexKey).sort().join(';');
    const current = this.territory.get(slot);
    if (current?.key === key) return;
    current?.mesh.dispose();
    this.territory.delete(slot);
    if (owned.length === 0) return;
    const c = linear(PLAYER_COLORS[slot % PLAYER_COLORS.length] ?? '#ffffff');
    const rgb = [c.r, c.g, c.b] as const;
    const glow = hexOverlay(
      owned,
      this.surface,
      [
        { scale: 0.6, alpha: CLAIMED.glow.fill },
        { scale: 1, alpha: CLAIMED.glow.edge },
      ],
      { size: HEX_SIZE, lift: OVERLAY_LIFT, rgb, centreAlpha: CLAIMED.glow.fill },
    );
    const border = territoryBorder(owned, this.surface, {
      size: HEX_SIZE,
      lift: OVERLAY_LIFT * 1.5,
      rgb,
      width: CLAIMED.border.width,
      alpha: CLAIMED.border.alpha,
    });
    const mesh = meshFrom(this.scene, `territory-${String(slot)}`, joinArrays(glow, border));
    mesh.material = this.overlayMat;
    this.territory.set(slot, { key, mesh });
  }

  /** The safe glow over tiles lit fires keep safe; rebuilt only when that set changed. */
  private drawSafeGlow(tiles: readonly PublicTile[]): void {
    const key = tiles.map(hexKey).sort().join(';');
    if (this.safeGlow.key === key) return;
    this.safeGlow.mesh?.dispose();
    this.safeGlow = { key, mesh: null };
    if (tiles.length === 0) return;
    const mesh = meshFrom(
      this.scene,
      'safe-glow',
      hexOverlay(
        tiles,
        this.surface,
        [
          { scale: 0.7, alpha: SAFE_GLOW.fill },
          { scale: 0.92, alpha: SAFE_GLOW.edge },
          { scale: 1, alpha: 0 },
        ],
        {
          size: HEX_SIZE,
          lift: OVERLAY_LIFT * 1.2,
          rgb: [...SAFE_GLOW.rgb],
          centreAlpha: SAFE_GLOW.fill,
        },
      ),
    );
    mesh.material = this.overlayMat;
    this.safeGlow.mesh = mesh;
  }

  /** Lanterns and flowers on claimed land (not home tiles or water); returns how many. */
  private drawFlourishes(owned: readonly PublicTile[]): number {
    const byKind = new Map<PropKind, Matrix[]>();
    const turn = new Quaternion();
    for (const tile of owned) {
      if (tile.homeSlot !== null || tile.terrain === 'lake') continue;
      for (const prop of flourishTile(tile, HEX_SIZE)) {
        Quaternion.RotationYawPitchRollToRef(prop.turn, 0, 0, turn);
        const list = byKind.get(prop.kind) ?? [];
        list.push(
          placeAt(
            prop.at.x,
            this.surface.heightAt(prop.at) ?? topOf(tile),
            prop.at.z,
            new Vector3(prop.scale, prop.scale, prop.scale),
            turn.clone(),
          ),
        );
        byKind.set(prop.kind, list);
      }
    }
    let count = 0;
    for (const kind of ['lantern', 'flowers'] as const) {
      let mesh = this.flourishes.get(kind);
      const matrices = byKind.get(kind) ?? [];
      if (!mesh && matrices.length === 0) continue;
      if (!mesh) {
        mesh = buildProp(this.scene, kind).mesh;
        mesh.name = `claimed-${kind}`;
        if (kind === 'lantern') {
          this.claimedLanternMat = vinyl(this.scene, 'claimed-lantern-mat', { color: '#ffffff' });
          mesh.material = this.claimedLanternMat;
          this.applyLanternGlow();
        } else {
          mesh.material = this.propMat();
        }
        this.flourishes.set(kind, mesh);
      }
      setInstances(mesh, matrices, true);
      count += matrices.length;
    }
    return count;
  }

  private propMaterial: PBRMaterial | null = null;
  private propPlugin: unknown = null;
  /** The shared prop material (vertex colours, sway and bob from the terrain plugin). */
  private propMat(): PBRMaterial {
    if (!this.propMaterial) {
      this.propMaterial = vinyl(this.scene, 'prop-mat', { color: '#ffffff' });
      this.propPlugin = attachTerrainPlugin(this.propMaterial, this.clock);
    }
    return this.propMaterial;
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

  /**
   * The continuous ground (one mesh, one draw call) and the lakes' water.
   */
  private buildGround(tiles: readonly PublicTile[]): void {
    const mesh = meshFrom(this.scene, 'ground', this.ground.mesh());
    mesh.hasVertexAlpha = false;
    const mat = vinyl(this.scene, 'ground-mat', {
      ...FALLBACK_LOOK,
      color: '#ffffff',
      roughness: 0.85,
    });
    mat.freeze();
    mesh.material = mat;
    mesh.freezeWorldMatrix();

    const lakes = tiles.filter((t) => t.terrain === 'lake');
    if (lakes.length === 0) return;
    const water = waterMesh(lakes, {
      size: HEX_SIZE,
      level: WATER.level,
      reach: WATER.reach,
      deep: { color: rgbOf(WATER.deep.color), alpha: WATER.deep.alpha },
      shallow: { color: rgbOf(WATER.shallow.color), alpha: WATER.shallow.alpha },
    });
    const waterSurface = meshFrom(this.scene, 'water', water);
    waterSurface.setVerticesData(SHORE_ATTRIBUTE, water.shore, false, 1);
    const waterMat = vinyl(this.scene, 'water-mat', { color: '#ffffff' });
    waterMat.roughness = 0.15;
    waterMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    attachTerrainPlugin(waterMat, this.clock, { water: true });
    waterSurface.material = waterMat;
    waterSurface.freezeWorldMatrix();
  }

  /**
   * Dressing for every terrain tile (map-dressing.ts), in clumps: one
   * thin-instanced mesh per prop kind, each instance with its colour
   * multiplier and its sway, phase and bob values (terrain-plugin.ts). Props
   * stand on the ground's surface, wherever on the tile they are.
   */
  private buildProps(tiles: readonly PublicTile[]): void {
    const shadows: Matrix[] = [];
    const placed = this.placeAll(
      tiles.flatMap((tile) =>
        tile.homeSlot !== null
          ? []
          : dressTile(tile, tile.terrain, HEX_SIZE, { halloween: this.halloween }).map((p) => ({
              tile,
              p,
            })),
      ),
      (kind, built, at, scale, y) => {
        // Only props big enough to cast a soft shadow get one (not tufts or flowers).
        if (built.shadow >= MIN_SHADOW) {
          const d = built.shadow * scale;
          shadows.push(placeAt(at.x, y + 0.004, at.z, new Vector3(d, 1, d)));
        }
      },
    );
    this.propCount = placed.instances;
    this.propKinds = placed.kinds;

    // Baked soft contact shadows: one round, vertex-alpha disc per prop.
    const shadow = meshFrom(
      this.scene,
      'prop-shadows',
      loftRoundedHex(1, [{ scale: 1, y: 0, alpha: 0 }], {
        corner: Math.sqrt(3) / 2, // fully rounded: a circle
        segments: 3,
        centre: { y: 0, alpha: 0.35 }, // TUNE
        rgb: [0.42, 0.29, 0.43],
      }),
    );
    shadow.material = overlayMaterial(this.scene, 'prop-shadow-mat');
    setInstances(shadow, shadows);
    shadow.freezeWorldMatrix();
  }

  /**
   * Tiny ground clutter (tufts, clover, pebbles, petals) on every land tile,
   * thin-instanced per kind. Instances are shuffled, so a tier's share
   * (`CLUTTER_SHARE`) thins them evenly over the whole map.
   */
  private buildClutter(tiles: readonly PublicTile[]): void {
    const items = tiles.flatMap((tile) =>
      tile.homeSlot !== null || tile.terrain === 'lake'
        ? []
        : clutterTile(tile, tile.terrain, HEX_SIZE).map((p) => ({ tile, p })),
    );
    items.sort(
      (a, b) =>
        hash01(Math.round(a.p.at.x * 100), Math.round(a.p.at.z * 100), 13) -
        hash01(Math.round(b.p.at.x * 100), Math.round(b.p.at.z * 100), 13),
    );
    const placed = this.placeAll(items, () => undefined, 'clutter');
    for (const mesh of placed.meshes) this.clutter.push({ mesh, count: mesh.thinInstanceCount });
  }

  /**
   * Places props on the surface, one thin-instanced mesh per kind (named
   * `prefix-kind` when a prefix is given), with colour and `terrainAmbient`
   * per instance. `each` sees every placement (for shadows).
   */
  private placeAll(
    items: readonly { tile: PublicTile; p: DressingPlacement }[],
    each: (kind: PropKind, built: BuiltProp, at: WorldPoint, scale: number, y: number) => void,
    prefix?: string,
  ): { instances: number; kinds: number; meshes: Mesh[] } {
    type Kind = { matrices: Matrix[]; tints: number[]; ambient: number[] };
    const byKind = new Map<PropKind, Kind>();
    const meshes = new Map<PropKind, BuiltProp>();
    const turn = new Quaternion();
    for (const { tile, p } of items) {
      let built = meshes.get(p.kind);
      if (!built) {
        built = buildProp(this.scene, p.kind);
        if (prefix) built.mesh.name = `${prefix}-${p.kind}`;
        meshes.set(p.kind, built);
      }
      const y = this.surface.heightAt(p.at) ?? topOf(tile);
      Quaternion.RotationYawPitchRollToRef(p.turn, 0, 0, turn);
      let kind = byKind.get(p.kind);
      if (!kind) byKind.set(p.kind, (kind = { matrices: [], tints: [], ambient: [] }));
      kind.matrices.push(
        placeAt(p.at.x, y, p.at.z, new Vector3(p.scale, p.scale, p.scale), turn.clone()),
      );
      kind.tints.push(...hexRgb(p.tint).map(toLinear), 1);
      const sway = PROP_SWAY[p.kind];
      // terrainAmbient: sway coefficient (tip / top²), phase, (unused), bob with the water.
      kind.ambient.push(
        sway ? sway.tip / (sway.top * sway.top) : 0,
        hash01(Math.round(p.at.x * 100), Math.round(p.at.z * 100), 5) * Math.PI * 2,
        0,
        p.kind === 'lily-pad' ? 1 : 0,
      );
      each(p.kind, built, p.at, p.scale, y);
    }
    // Jack-o'-lanterns and Juniper's crystals glow softly (lanterns brighter at night).
    const glowing = (name: string, color: string, glow: number): PBRMaterial => {
      const m = vinyl(this.scene, name, { color: '#ffffff' });
      m.emissiveColor = linear(color).scale(glow);
      attachTerrainPlugin(m, this.clock);
      return m;
    };
    let instances = 0;
    const out: Mesh[] = [];
    for (const [kindName, { mesh }] of meshes) {
      const kind = byKind.get(kindName);
      if (!kind) continue;
      if (kindName === 'jack-o-lantern') {
        this.lanternMat = glowing('lantern-mat', HALLOWEEN.glowColor, HALLOWEEN.glow.day);
        mesh.material = this.lanternMat;
      } else if (kindName === 'crystal') {
        mesh.material = glowing('crystal-mat', CRYSTAL_GLOW.color, CRYSTAL_GLOW.strength);
      } else {
        mesh.material = this.propMat();
      }
      setInstances(mesh, kind.matrices);
      mesh.thinInstanceSetBuffer('color', new Float32Array(kind.tints), 4, true);
      mesh.thinInstanceSetBuffer(AMBIENT_ATTRIBUTE, new Float32Array(kind.ambient), 4, true);
      mesh.freezeWorldMatrix();
      instances += kind.matrices.length;
      out.push(mesh);
    }
    return { instances, kinds: out.length, meshes: out };
  }

  /** Sandy paths from each home's Heart Seed out to a few neighbouring tiles. */
  private buildPaths(tiles: readonly PublicTile[]): void {
    const routes = homePaths(tiles, HEX_SIZE, PATHS.links);
    if (routes.length === 0) return;
    const c = linear(PATHS.color);
    const parts = routes.map((route) =>
      pathRibbon(route, this.surface, {
        size: HEX_SIZE,
        lift: OVERLAY_LIFT * 0.5,
        rgb: [c.r, c.g, c.b],
        width: PATHS.width,
        alpha: PATHS.alpha,
      }),
    );
    const mesh = meshFrom(this.scene, 'paths', parts.reduce(joinArrays));
    mesh.material = this.overlayMat;
    mesh.freezeWorldMatrix();
  }

  /** Pushes night, mode and the tier's share into the motes, clutter, backdrop and lanterns. */
  private applyAmbient(): void {
    if (this.judge.slow && this.mode === 'live') this.mode = 'off';
    this.ambient.set({ night: this.night, mode: this.mode, share: this.share });
    const tierShare = AMBIENT.clutter[this.tier];
    for (const { mesh, count } of this.clutter) {
      // Hidden by disabling, never by a count of 0 (see map-ambient.ts).
      const n = Math.round(count * tierShare);
      mesh.thinInstanceCount = Math.max(1, n);
      mesh.setEnabled(n > 0);
    }
    if (this.lanternMat) {
      const glow = this.night ? HALLOWEEN.glow.night : HALLOWEEN.glow.day;
      this.lanternMat.emissiveColor = linear(HALLOWEEN.glowColor).scale(glow);
    }
    this.applyLanternGlow();
  }

  private applyLanternGlow(): void {
    if (!this.claimedLanternMat) return;
    const glow = this.night ? CLAIMED.lanternGlow.night : CLAIMED.lanternGlow.day;
    this.claimedLanternMat.emissiveColor = linear(CLAIMED.lanternGlow.color).scale(glow);
  }

  /** Juniper's Gap landmark (design doc §2): a glowing tree on the centre tile. */
  private buildGap(): void {
    const centre = this.tiles.get(hexKey({ q: 0, r: 0 }));
    if (centre?.terrain !== 'junipers-gap') return;
    const h = topOf(centre);
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

/** Node resources drawn as props in the middle of their tile (the map and Home). */
export const NODE_PROPS: Readonly<Record<string, PropKind>> = {
  timber: 'tree',
  stone: 'rock',
  emberwood: 'old-tree',
  treats: 'pumpkin',
  pumpkins: 'pumpkin',
};

/** Draws every home node, one instanced mesh per prop kind; returns how many. */
function buildHomeNodes(scene: Scene, tiles: readonly PublicTile[]): number {
  const byKind = new Map<PropKind, Matrix[]>();
  let count = 0;
  for (const tile of tiles) {
    const kind = tile.homeSlot !== null && tile.nodeResource ? NODE_PROPS[tile.nodeResource] : null;
    if (!kind) continue;
    const p = hexToWorld(tile, HEX_SIZE);
    const list = byKind.get(kind) ?? [];
    list.push(placeAt(p.x, HOME_LOOK.height + DOME * 0.5, p.z));
    byKind.set(kind, list);
    count++;
  }
  if (count === 0) return 0;
  const mat = vinyl(scene, 'home-node-mat', { color: '#ffffff' });
  mat.freeze();
  for (const [kind, matrices] of byKind) {
    const { mesh } = buildProp(scene, kind);
    mesh.name = `home-node-${kind}`;
    mesh.material = mat;
    setInstances(mesh, matrices);
    mesh.freezeWorldMatrix();
  }
  return count;
}

/** This player's home node to point at: Timber first (the tutorial's gather step). */
export function homeNodeOf(tiles: readonly PublicTile[], userId: string | null): PublicTile | null {
  if (userId === null) return null;
  const nodes = tiles.filter(
    (t) => t.homeSlot !== null && t.ownerUserId === userId && t.nodeResource !== null,
  );
  return nodes.find((t) => t.nodeResource === 'timber') ?? nodes[0] ?? null;
}

/** A box on screen in CSS pixels (the tutorial overlay's `Rect`). */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Scratch vectors for `tileScreenRect`, which runs every drawn frame while followed. */
const RIM = new Vector3();
const PROJECTED = new Vector3();

/**
 * A tile's box on screen (its rim at height `top`), or null if the camera
 * can't see it. Its middle is the tile's middle, so a tap there picks the
 * tile. Projects with the camera as it is now, so it follows pans and zooms.
 */
function tileScreenRect(scene: Scene, h: Hex, top: number): ScreenRect | null {
  const camera = scene.activeCamera;
  const canvas = scene.getEngine().getRenderingCanvas();
  if (!camera || !canvas) return null;
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const viewport = camera.viewport.toGlobal(box.width, box.height);
  const transform = camera.getTransformationMatrix();
  const c = hexToWorld(h, HEX_SIZE);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    RIM.set(c.x + Math.cos(a) * TILE_RADIUS, top, c.z + Math.sin(a) * TILE_RADIUS);
    const s = Vector3.ProjectToRef(RIM, Matrix.IdentityReadOnly, transform, viewport, PROJECTED);
    if (s.z < 0 || s.z > 1) return null; // behind the camera or past the far plane
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  return { x: box.left + x0, y: box.top + y0, width: x1 - x0, height: y1 - y0 };
}
