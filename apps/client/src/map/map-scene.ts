import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
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
  GAME_DATA,
  hexKey,
  hexToWorld,
  isTradingPost,
  worldToHex,
  type Hex,
  type HexKey,
  type MapView,
  KEEPER_DATA,
  type PublicTile,
} from '@heartpatch/shared';
import type { Bounds, GroundPoint } from '../engine/camera/camera-math.js';
import { MAP_BUILDING_SCALE, MAP_OUTER_FIRE_SCALE, SAFE_GLOW } from '../home/home-config.js';
import { mapBuildings, mapSafeTiles } from '../home/home-layout.js';
import { BuildingField } from '../procedural/buildings/building-field.js';
import { BorderField } from './border-field.js';
import { FenceField } from './fence-field.js';
import { fenceLength, fencePlacements } from './fence-layout.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { KeeperField } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { AmbientJudge, ambientMode, moteShare, type AmbientMode } from './ambient-layout.js';
import { loftRoundedHex, type MeshArrays, type ProfileRing } from './hex-mesh.js';
import { MapAmbient, type AmbientStats } from './map-ambient.js';
import {
  CRYSTAL_GLOW,
  FALLBACK_LOOK,
  HALLOWEEN,
  HEX_SIZE,
  HOME_LOOK,
  BORDER,
  ISLAND,
  LAND_FADE,
  MUTED,
  PROP_SWAY,
  TERRAIN_LOOKS,
  TILE_FILL,
  type PropKind,
  type TerrainLook,
  WILD_MARKER,
} from './map-config.js';
import { dressTile, hexRgb, isMuted, muteRgb, tileColor, tileJitter } from './map-dressing.js';
import { findHomeBases, hash01, mapBounds, mapRadius } from './map-layout.js';
import { buildProp, buildWildTuft, linear, merged, painted } from './map-props.js';
import type { WildMarker } from './wild-markers.js';
import { AMBIENT_ATTRIBUTE, attachTerrainPlugin, TerrainClock } from './terrain-plugin.js';
import type { QualityTier } from '../engine/config.js';

// Prop builders moved to map-props.ts; re-exported here, where other screens
// (home, cinematic, battle) import them from.
export { buildProp, merged, painted, type BuiltProp } from './map-props.js';

// The world map (#7): instanced hex tiles, land borders (#278), home bases,
// Juniper's Gap and props, drawn from the server's map view. One draw call per
// terrain, per Keeper's border and per prop kind, however many tiles (CLAUDE.md
// rule 8). No textures: soft edges and baked contact shadows are vertex alpha.
// The terrain visual pass adds per-tile colour and height wobble, wild land
// drawn muted, many more props, Halloween dressing and ambient life (sway,
// water, motes), all moved on the GPU by one time uniform (terrain-plugin.ts).

export const TILE_RADIUS = HEX_SIZE * TILE_FILL;
/** Rounded-top profile shared by tiles and the overlays laid over them (top at y = 0). */
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
/** Overlays (selection, safe glow) float this far above the tile so they never z-fight. */
const TINT_LIFT = 0.012;
/** Fences stand near a tile's rim, where its rounded top has dropped a little. TUNE */
const FENCE_LIFT = DOME * 0.2;
/** Highest a tap can land, for the first guess when picking a tile. */
const PICK_HEIGHT = 0.25;

/** Read-only numbers for the dev hook and tests. */
export interface MapSceneStats {
  readonly tiles: number;
  /** Resource-node props on home bases (Timber trees, Stone rocks…). */
  readonly homeNodes: number;
  /** Tiles drawn in a player's colour (home rings included). */
  readonly tinted: number;
  /** Land borders (#278): one mesh (draw call) per Keeper with land, and their triangles. */
  readonly borderMeshes: number;
  readonly borderTriangles: number;
  readonly homes: number;
  readonly claimedHomes: number;
  /** Meshes drawing tiles: one per terrain look in use, plus home tiles. */
  readonly tileMeshes: number;
  /** Keepers standing at their home bases (#42). */
  readonly keepers: number;
  /** Buildings on home bases (#18), and the Hearthfires among them drawn lit. */
  readonly buildings: number;
  readonly litFires: number;
  /** Fence segments on hex edges (#203). */
  readonly fences: number;
  /** Tiles under a lit Hearthfire's soft glow (its safe radius, #18). */
  readonly safeTiles: number;
  /** Clothing ids each drawn Keeper wears (#43), by drawing order. */
  readonly keepersWearing: readonly (readonly string[])[];
  /** Dressing props on the map, and how many kinds (one draw call each). */
  readonly props: number;
  readonly propKinds: number;
  /** Tiles drawn muted (wild land nobody owns), and the props on them. */
  readonly mutedTiles: number;
  readonly mutedProps: number;
  /** Halloween dressing is on (season, map-local date). */
  readonly halloween: boolean;
  readonly night: boolean;
  /** Ambient life: `live`, `still` (reduced motion) or `off` (low tier or a slow device). */
  readonly ambient: AmbientMode;
  readonly motes: AmbientStats['motes'];
  /** Wild-squishy tufts drawn (#209), all from one instanced mesh. */
  readonly wildMarkers: number;
}

export interface MapSceneOptions {
  /** Halloween is on for this map (shared `activeSeasons`, map-local date). */
  readonly halloween?: boolean;
  /** Every season on for this map (map-local date): seasonal home nodes show only in theirs. */
  readonly seasons?: readonly string[];
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

/** Height of a tile's top: its look's, plus its own small wobble (none on home tiles). */
/** A tile's top surface height, world units (layers that sit on a tile use it). */
export function topOf(tile: PublicTile): number {
  const look = lookOf(tile);
  return tile.homeSlot !== null ? look.height : look.height + tileJitter(tile, tile.terrain).height;
}

/** One instanced tile mesh and the tiles it draws, for recolouring when ownership changes. */
interface TileGroup {
  readonly mesh: Mesh;
  readonly look: TerrainLook;
  readonly tiles: PublicTile[];
  readonly colors: Float32Array;
  /** How muted each tile is drawn: 1 on wild land, part way on land that misses its owner. */
  readonly muted: number[];
}

/** One prop kind's instances, for re-muting when ownership changes. */
interface PropGroup {
  readonly mesh: Mesh;
  /** Each instance's tile key. */
  readonly tiles: HexKey[];
  /** `terrainAmbient` per instance: sway, phase, muted, bob. */
  readonly ambient: Float32Array;
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

/** Unlit, vertex-coloured and alpha-blended: borders, selection and blob shadows. */
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
 * within a map (Phase 1), so tiles are built once; ownership and home bases
 * are redrawn by `update` whenever the map view changes.
 */
export class MapScene {
  readonly bounds: Bounds;
  private readonly scene: Scene;
  private readonly tiles = new Map<HexKey, PublicTile>();
  /** Whose land is whose (#278): a wash, a ribbon on the outer edges, and icons. */
  private readonly borders: BorderField;
  private readonly seedMesh: Mesh;
  private readonly plotMesh: Mesh;
  private readonly selection: Mesh;
  /** Each member's Keeper by their Heart Seed (design doc §23). Low detail; never animates here. */
  private readonly keepers: KeeperField;
  /** Fires and habitats on home bases (#18), at map scale. */
  private readonly buildings: BuildingField;
  /** Fence segments along tile edges (#203). */
  private readonly fences: FenceField;
  /** The soft glow over tiles a lit Hearthfire keeps safe (#18). */
  private readonly safeGlow: Mesh;
  /** The player's home node the tutorial points at (`homeNodeRect`), until `update`. */
  private homeNode: { userId: string | null; tile: PublicTile | null } | null = null;
  /** Resource nodes drawn on home bases (`buildHomeNodes`). */
  private readonly homeNodes: number;
  private tileMeshes = 0;
  private counts = { homes: 0, claimedHomes: 0, safeTiles: 0 };
  /** My land that misses me: how far each tile has faded (0–1), by tile. */
  private landFade = new Map<HexKey, number>();
  /** Ambient time: every terrain material reads it (terrain-plugin.ts). */
  private readonly clock = new TerrainClock();
  private readonly halloween: boolean;
  private readonly tileGroups: TileGroup[] = [];
  private readonly propGroups: PropGroup[] = [];
  private propCount = 0;
  /** Glowing props whose glow changes at night (jack-o'-lanterns). */
  private lanternMat: PBRMaterial | null = null;
  private readonly ambient: MapAmbient;
  /** False under WebGPU: the terrain plugin is GLSL only, so nothing moves there. */
  private readonly animated: boolean;
  private night = false;
  private mode: AmbientMode = 'live';
  private share = 1;
  private readonly judge = new AmbientJudge();
  /** Wall-clock ms at ambient-time zero (the first `tick`). */
  private clockStart: number | null = null;
  /** The wild-squishy tufts (#209): one mesh, a thin instance per marked tile. */
  private readonly wildMesh: Mesh;
  private wild: readonly WildMarker[] = [];

  constructor(scene: Scene, view: MapView, options: MapSceneOptions = {}) {
    this.scene = scene;
    this.halloween = options.halloween === true;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    for (const t of view.tiles) this.tiles.set(hexKey(t), t);
    this.bounds = mapBounds(view.tiles, HEX_SIZE);

    this.buildIsland(view.tiles);
    this.animated = this.buildTiles(view.tiles);
    this.buildProps(view.tiles);
    this.homeNodes = buildHomeNodes(scene, view.tiles, new Set(options.seasons ?? []));
    this.buildGap();
    this.ambient = new MapAmbient(scene, view.tiles, this.clock, {
      halloween: this.halloween,
      thanksgiving: options.seasons?.includes('thanksgiving') === true,
      islandRadius: mapRadius(view.tiles, HEX_SIZE) + ISLAND.margin,
    });
    // Start as the tier and motion setting say, so nothing shows for a frame
    // that would then be hidden (drifting motes under reduced motion).
    const tier = options.tier ?? 'high';
    this.mode = this.animated
      ? ambientMode({ tier, reducedMotion: options.reducedMotion === true, slow: false })
      : 'off';
    this.share = moteShare(tier);
    this.applyAmbient();

    this.borders = new BorderField(scene, {
      shape: {
        size: HEX_SIZE,
        radius: TILE_RADIUS,
        corner: CORNER,
        segments: SEGMENTS,
        dome: DOME,
        rings: TOP_RINGS,
      },
      topOf,
      material: overlayMaterial(scene, 'border-mat'),
      meshFrom,
    });
    this.seedMesh = buildHeartSeed(scene);
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

    // No contact shadows: map props have none either, and Keepers are tiny here.
    this.keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: 'low', shadows: false });
    this.buildings = new BuildingField(scene);
    const fenceMat = vinyl(scene, 'fence-mat', { color: '#ffffff' });
    fenceMat.freeze();
    this.fences = new FenceField(scene, {
      length: fenceLength(HEX_SIZE),
      material: fenceMat,
      setInstances,
      placeAt,
    });
    this.safeGlow = meshFrom(
      scene,
      'safe-glow',
      loftRoundedHex(
        TILE_RADIUS,
        [
          { scale: 0.5, y: DOME * 0.75, alpha: SAFE_GLOW.fill },
          { scale: 0.8, y: DOME * 0.25, alpha: SAFE_GLOW.fill },
          { scale: 0.92, y: -BEVEL * 0.25, alpha: SAFE_GLOW.edge },
          { scale: 1, y: -BEVEL, alpha: 0 },
        ],
        {
          corner: CORNER,
          segments: SEGMENTS,
          centre: { y: DOME, alpha: SAFE_GLOW.fill },
          rgb: [...SAFE_GLOW.rgb],
        },
      ),
    );
    this.safeGlow.material = overlayMaterial(scene, 'safe-glow-mat');
    this.safeGlow.setEnabled(false);

    this.wildMesh = buildWildTuft(scene);
    const wildMat = vinyl(scene, 'wild-tuft-mat', { color: '#ffffff' });
    attachTerrainPlugin(wildMat, this.clock);
    this.wildMesh.material = wildMat;
    setInstances(this.wildMesh, []);
    this.update(view);
  }

  get stats(): MapSceneStats {
    return {
      tiles: this.tiles.size,
      tileMeshes: this.tileMeshes,
      homeNodes: this.homeNodes,
      ...this.counts,
      tinted: this.borders.tinted,
      borderMeshes: this.borders.stats.meshes,
      borderTriangles: this.borders.stats.triangles,
      keepers: this.keepers.handles.length,
      buildings: this.buildings.stats.buildings,
      litFires: this.buildings.stats.lit,
      fences: this.fences.count,
      keepersWearing: this.keepers.handles.map((h) => h.params.worn),
      props: this.propCount,
      propKinds: this.propGroups.length,
      mutedTiles: this.tileGroups.reduce((n, g) => n + g.muted.filter((m) => m === 1).length, 0),
      mutedProps: this.propGroups.reduce(
        (n, g) => n + g.ambient.filter((v, i) => i % 4 === 2 && v === 1).length,
        0,
      ),
      halloween: this.halloween,
      night: this.night,
      ambient: this.mode,
      motes: this.ambient.stats.motes,
      wildMarkers: this.wild.length,
    };
  }

  /**
   * Draws a rustling tuft on each marked tile (#209), replacing the last set.
   * One mesh however many: a thin instance each, swaying on the terrain clock
   * (`terrainAmbient`), so an idle map stays idle.
   */
  setWild(markers: readonly WildMarker[]): void {
    const placed = markers.flatMap((m) => {
      const tile = this.tiles.get(m.key);
      return tile ? [{ marker: m, tile }] : [];
    });
    // A redraw (any live event) with the same tufts: nothing to rebuild.
    const same =
      placed.length === this.wild.length &&
      placed.every((p, i) => p.marker.key === this.wild[i]?.key);
    if (same) return;
    this.wild = placed.map((p) => p.marker);
    const { offset, scale, sway } = WILD_MARKER;
    const size = new Vector3(scale, scale, scale);
    setInstances(
      this.wildMesh,
      placed.map(({ tile }) => {
        const p = hexToWorld(tile, HEX_SIZE);
        return placeAt(p.x + offset.x, topOf(tile) + DOME * 0.5, p.z + offset.z, size);
      }),
      true,
    );
    if (placed.length === 0) return;
    // terrainAmbient: sway coefficient (tip / top², as props), phase, never muted, no bob.
    const k = sway.tip / (sway.top * sway.top);
    const ambient = new Float32Array(placed.length * 4);
    placed.forEach(({ marker }, i) => {
      ambient.set([k, marker.phase, 0, 0], i * 4);
    });
    this.wildMesh.thinInstanceSetBuffer(AMBIENT_ATTRIBUTE, ambient, 4, false);
  }

  /** Where each tuft's tile is on screen (CSS pixels), for the dev hook; unseen ones are left out. */
  wildRects(): { key: HexKey; rect: ScreenRect }[] {
    return this.wild.flatMap((m) => {
      const tile = this.tiles.get(m.key);
      const rect = tile ? tileScreenRectOf(this.scene, tile) : null;
      return rect ? [{ key: m.key, rect }] : [];
    });
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
    if (mode === this.mode && share === this.share) return false;
    this.mode = mode;
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
    this.borders.setNight(night ? BORDER.night : 0);
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
    this.recolour();
    this.homeNode = null;
    this.borders.set(this.tiles.values(), view.members);

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
        level: building.level,
        lit: building.lit,
        x: at.x,
        z: at.z,
        y: topOf(tile) + DOME * 0.5,
        scale: HEX_SIZE * (tile.homeSlot === null ? MAP_OUTER_FIRE_SCALE : MAP_BUILDING_SCALE),
      })),
    );
    // Fence segments on the edges (#203): a border reads as one fence line.
    this.fences.set(
      fencePlacements(view, HEX_SIZE).map(({ tile, fence, x, z, yaw }) => ({
        buildingId: fence.buildingId,
        level: fence.level,
        x,
        y: topOf(tile) + FENCE_LIFT,
        z,
        yaw,
      })),
    );
    const safe: Matrix[] = [];
    for (const key of mapSafeTiles(view)) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      const p = hexToWorld(tile, HEX_SIZE);
      safe.push(placeAt(p.x, topOf(tile) + TINT_LIFT * 1.5, p.z));
    }
    setInstances(this.safeGlow, safe, true);
    this.counts = {
      homes: homes.length,
      claimedHomes: seeds.length,
      safeTiles: safe.length,
    };
  }

  /** Rings the selected tile, or clears the ring (null). */
  select(h: Hex | null): void {
    const tile = h ? this.tiles.get(hexKey(h)) : undefined;
    if (!tile) {
      this.selection.setEnabled(false);
      return;
    }
    const p = hexToWorld(tile, HEX_SIZE);
    this.selection.position.set(p.x, topOf(tile), p.z);
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
    return tile ? tileScreenRectOf(this.scene, tile) : null;
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
    // Softened like wild land (part way), since nobody ever owns the island.
    const green = hexRgb(ISLAND.color);
    const soft = muteRgb(green);
    mat.albedoColor = new Color3(
      ...green.map((v, i) => toLinear(v + ((soft[i] ?? v) - v) * MUTED.island)),
    );
    for (const m of [island, rim]) {
      m.material = mat;
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
  }

  /**
   * One mesh per terrain look (plus home tiles), each drawing all its tiles
   * at once. Each tile carries its own colour (a small wobble, muted on wild
   * land) and height wobble in its instance data. True if the terrain plugin
   * runs here (GLSL), so ambient life can move.
   */
  private buildTiles(tiles: readonly PublicTile[]): boolean {
    const groups = new Map<TerrainLook, { key: string; tiles: PublicTile[] }>();
    for (const tile of tiles) {
      const look = lookOf(tile);
      let group = groups.get(look);
      if (!group) {
        group = { key: tile.homeSlot !== null ? 'home' : tile.terrain, tiles: [] };
        groups.set(look, group);
      }
      group.tiles.push(tile);
    }
    let animated = true;
    for (const [look, group] of groups) {
      const h = look.height;
      const mesh = meshFrom(
        this.scene,
        `tiles-${group.key}`,
        loftRoundedHex(
          TILE_RADIUS,
          [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
          { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
        ),
      );
      // White albedo: each tile's colour comes from its instance colour.
      const mat = vinyl(this.scene, `tiles-${group.key}-mat`, { ...look, color: '#ffffff' });
      if (look.glow > 0) mat.emissiveColor = linear(look.color).scale(look.glow);
      const plugin = attachTerrainPlugin(mat, this.clock, { water: group.key === 'lake' });
      if (!plugin) animated = false;
      mesh.material = mat;
      // Height wobble scales the tile, so its top lands at `topOf(tile)`.
      setInstances(
        mesh,
        group.tiles.map((tile) => {
          const p = hexToWorld(tile, HEX_SIZE);
          return placeAt(p.x, 0, p.z, new Vector3(1, (topOf(tile) + DOME) / (h + DOME), 1));
        }),
      );
      const colors = new Float32Array(group.tiles.length * 4);
      mesh.thinInstanceSetBuffer('color', colors, 4, false);
      mesh.freezeWorldMatrix();
      this.tileGroups.push({
        mesh,
        look,
        tiles: group.tiles,
        colors,
        muted: group.tiles.map(() => 0),
      });
    }
    this.tileMeshes = groups.size;
    this.recolour(true);
    return animated;
  }

  /**
   * Land that misses this player (owner decision 2026-10-06): how far each of
   * their tiles has faded (0–1), drawn part of the way to wild.
   */
  setLandFade(fade: ReadonlyMap<HexKey, number>): void {
    this.landFade = new Map(fade);
    this.recolour();
  }

  /** Recolours tiles and props whose wildness changed (all of them with `force`). */
  private recolour(force = false): void {
    if (this.tileGroups.length === 0) return;
    const wild = new Map<HexKey, number>();
    for (const group of this.tileGroups) {
      let changed = false;
      for (const [i, stale] of group.tiles.entries()) {
        const key = hexKey(stale);
        const tile = this.tiles.get(key) ?? stale;
        const fading = tile.homeSlot === null ? (this.landFade.get(key) ?? 0) : 0;
        const muted = isMuted(tile) ? 1 : Math.min(1, Math.max(0, fading)) * LAND_FADE.most;
        wild.set(key, muted);
        if (!force && group.muted[i] === muted) continue;
        group.muted[i] = muted;
        changed = true;
        const c =
          tile.homeSlot !== null
            ? tileColor(group.look.color, { brightness: 1, warmth: 0, height: 0 }, muted)
            : tileColor(group.look.color, tileJitter(tile, tile.terrain), muted);
        group.colors.set([...c.map(toLinear), 1], i * 4);
      }
      if (changed) group.mesh.thinInstanceBufferUpdated('color');
    }
    for (const group of this.propGroups) {
      let changed = false;
      for (const [i, key] of group.tiles.entries()) {
        const muted = wild.get(key) ?? 0;
        if (group.ambient[i * 4 + 2] === muted) continue;
        group.ambient[i * 4 + 2] = muted;
        changed = true;
      }
      if (changed) group.mesh.thinInstanceBufferUpdated(AMBIENT_ATTRIBUTE);
    }
  }

  /**
   * Dressing for every terrain tile (map-dressing.ts): one thin-instanced
   * mesh per prop kind, each instance with its colour multiplier and its
   * sway, phase, muted and bob values (terrain-plugin.ts).
   */
  private buildProps(tiles: readonly PublicTile[]): void {
    type Kind = { matrices: Matrix[]; tints: number[]; ambient: number[]; tiles: HexKey[] };
    const byKind = new Map<PropKind, Kind>();
    const shadows: Matrix[] = [];
    const meshes = new Map<PropKind, { mesh: Mesh; shadow: number }>();
    const turn = new Quaternion();
    for (const tile of tiles) {
      if (tile.homeSlot !== null) continue;
      const top = topOf(tile);
      const key = hexKey(tile);
      // A #238 node (a well, greens, ice) stands in the middle, as a prop, so
      // it's muted on wild land and sits at the tile's own height.
      const node = tile.nodeResource;
      // A trading post's hut stands on its centre spot (#269), like a node.
      const middle: PropKind | undefined = isTradingPost(tile)
        ? 'trading-post'
        : node !== null && LAND_NODES.has(node)
          ? NODE_PROPS[node]
          : undefined;
      const dressing = dressTile(tile, tile.terrain, HEX_SIZE, {
        halloween: this.halloween,
        ...(middle !== undefined && { middle }),
      });
      for (const prop of dressing) {
        let built = meshes.get(prop.kind);
        if (!built) {
          built = buildProp(this.scene, prop.kind);
          meshes.set(prop.kind, built);
        }
        Quaternion.RotationYawPitchRollToRef(prop.turn, 0, 0, turn);
        const s = new Vector3(prop.scale, prop.scale, prop.scale);
        let kind = byKind.get(prop.kind);
        if (!kind)
          byKind.set(prop.kind, (kind = { matrices: [], tints: [], ambient: [], tiles: [] }));
        kind.matrices.push(placeAt(prop.at.x, top + DOME * 0.5, prop.at.z, s, turn.clone()));
        kind.tints.push(...hexRgb(prop.tint).map(toLinear), 1);
        const sway = PROP_SWAY[prop.kind];
        // terrainAmbient: sway coefficient (tip / top²), phase, muted (set by recolour), bob.
        kind.ambient.push(
          sway ? sway.tip / (sway.top * sway.top) : 0,
          hash01(Math.round(prop.at.x * 100), Math.round(prop.at.z * 100), 5) * Math.PI * 2,
          0,
          prop.kind === 'lily-pad' ? 1 : 0,
        );
        kind.tiles.push(key);
        if (built.shadow > 0) {
          const d = built.shadow * prop.scale;
          // Just over the dome's crown, so no part of the disc dips under the tile
          // top (it doesn't write depth, so the slight float off-centre never shows).
          shadows.push(placeAt(prop.at.x, top + DOME + 0.004, prop.at.z, new Vector3(d, 1, d)));
        }
      }
    }
    const propMat = vinyl(this.scene, 'prop-mat', { color: '#ffffff' });
    attachTerrainPlugin(propMat, this.clock);
    // Jack-o'-lanterns and Juniper's crystals glow softly (lanterns brighter at night).
    const glowing = (name: string, color: string, glow: number): PBRMaterial => {
      const m = vinyl(this.scene, name, { color: '#ffffff' });
      m.emissiveColor = linear(color).scale(glow);
      attachTerrainPlugin(m, this.clock);
      return m;
    };
    this.propCount = 0;
    for (const [kindName, { mesh }] of meshes) {
      const kind = byKind.get(kindName);
      if (!kind) continue;
      if (kindName === 'jack-o-lantern') {
        this.lanternMat = glowing('lantern-mat', HALLOWEEN.glowColor, HALLOWEEN.glow.day);
        mesh.material = this.lanternMat;
      } else if (kindName === 'crystal') {
        mesh.material = glowing('crystal-mat', CRYSTAL_GLOW.color, CRYSTAL_GLOW.strength);
      } else {
        mesh.material = propMat;
      }
      setInstances(mesh, kind.matrices);
      mesh.thinInstanceSetBuffer('color', new Float32Array(kind.tints), 4, true);
      const ambient = new Float32Array(kind.ambient);
      mesh.thinInstanceSetBuffer(AMBIENT_ATTRIBUTE, ambient, 4, false);
      mesh.freezeWorldMatrix();
      this.propGroups.push({ mesh, tiles: kind.tiles, ambient });
      this.propCount += kind.matrices.length;
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

  /** Pushes night, mode and the tier's share into the motes, backdrop and lanterns. */
  private applyAmbient(): void {
    if (this.judge.slow && this.mode === 'live') this.mode = 'off';
    this.ambient.set({ night: this.night, mode: this.mode, share: this.share });
    if (this.lanternMat) {
      const glow = this.night ? HALLOWEEN.glow.night : HALLOWEEN.glow.day;
      this.lanternMat.emissiveColor = linear(HALLOWEEN.glowColor).scale(glow);
    }
  }

  /** Juniper's Gap landmark (design doc §2): a glowing tree on the centre tile. */
  private buildGap(): void {
    const centre = this.tiles.get(hexKey({ q: 0, r: 0 }));
    if (centre?.terrain !== 'junipers-gap') return;
    const h = topOf(centre) + DOME * 0.5;
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

// ── Home nodes ────────────────────────────────────────────────────────────
// Each home base's resource nodes (Timber, Stone, Emberwood, the farm plot),
// drawn in the middle of their tile as on the Home view, so "tap the tree
// tile" has a tree to tap. Kept apart from the terrain props above, which
// skip home tiles. The #238 nodes (Water, Greens, Ice) out on the land are
// drawn with those props (`buildProps`, `LAND_NODES`).

/** Node resources drawn as props in the middle of their tile (the map and Home). */
export const NODE_PROPS: Readonly<Record<string, PropKind>> = {
  timber: 'tree',
  stone: 'rock',
  emberwood: 'old-tree',
  treats: 'pumpkin',
  // Seasonal home nodes (owner decision 2026-10-06): a pumpkin patch with a
  // carved one, so it reads apart from the farm plot, and Thanksgiving's leaf pile.
  pumpkins: 'pumpkin-patch',
  'magic-fallen-leaves': 'leaf-pile',
  // #238: out on the land these are drawn with the terrain props (`LAND_NODES`).
  water: 'well',
  greens: 'greens-patch',
  ice: 'ice-crystals',
};

/**
 * Nodes drawn out on the land too, not only at home (#238, owner-approved
 * mockup 2026-10-07): a lake with a well says "you can gather here" at a
 * glance. They stand in the tile's middle with the terrain props.
 */
export const LAND_NODES: ReadonlySet<string> = new Set(['water', 'greens', 'ice']);

const NODE_SEASONS = new Map(GAME_DATA.resources.map((r) => [r.id, r.season]));

/**
 * Whether a home node shows: a seasonal one (the Pumpkin node, the leaf
 * pile) only while its season is on (owner decision 2026-10-06). Its middle
 * spot stays taken all year, so nothing gets built where it will grow back.
 */
export function homeNodeShown(resourceId: string, seasons: ReadonlySet<string>): boolean {
  const season = NODE_SEASONS.get(resourceId);
  return season === undefined || seasons.has(season);
}

/** Draws every home node, one instanced mesh per prop kind; returns how many. */
function buildHomeNodes(
  scene: Scene,
  tiles: readonly PublicTile[],
  seasons: ReadonlySet<string>,
): number {
  const byKind = new Map<PropKind, Matrix[]>();
  let count = 0;
  for (const tile of tiles) {
    const node = tile.homeSlot !== null ? tile.nodeResource : null;
    const kind = node && homeNodeShown(node, seasons) ? NODE_PROPS[node] : null;
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

/**
 * Where a tile is on screen (CSS pixels, its top at the tile's own height),
 * or null if the camera can't see it. The one projection for anything drawn
 * over the map in the DOM: the tutorial's spotlight and squishy jobs'
 * gatherer badges. Projects with the camera as it is now.
 */
export function tileScreenRectOf(scene: Scene, tile: PublicTile): ScreenRect | null {
  return tileScreenRect(scene, tile, lookOf(tile).height);
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
