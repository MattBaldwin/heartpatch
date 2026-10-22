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
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
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
  type CommunityKindId,
  type Hex,
  type HexKey,
  type MapView,
  KEEPER_DATA,
  TRICK_OR_TREAT,
  type PublicTile,
} from '@heartpatch/shared';
import type { Bounds, GroundPoint } from '../engine/camera/camera-math.js';
import { activeTriangles } from '../engine/render-stats.js';
import {
  HOME_FILL,
  MAP_BUILDING_SCALE,
  MAP_OUTER_BUILDING_SCALE,
  MAP_OUTER_FIRE_SCALE,
  SAFE_GLOW,
} from '../home/home-config.js';
import { filledTiles, mapBuildings, mapSafeTiles, nodeAside } from '../home/home-layout.js';
import { BuildingField, type BuildingPlacement } from '../procedural/buildings/building-field.js';
import { BorderField } from './border-field.js';
import { BuildAreaField, type BuildAreaView } from './build-area.js';
import { buildAreaAt, type BuildAreaHit } from './build-area-layout.js';
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
  EXPLORED_MARK,
  PORCH_LANTERN,
  FALLBACK_LOOK,
  HALLOWEEN,
  HEX_SIZE,
  HOMESTEAD_GLOW,
  HOME_LOOK,
  HOLLOWED_LOOK,
  HOLLOWED_SQUARE,
  BORDER,
  ISLAND,
  LAND_FADE,
  MAP_DETAIL,
  MUTED,
  PROP_SWAY,
  TERRAIN_LOOKS,
  TILE_FILL,
  type PropKind,
  type TerrainLook,
  WILD_MARKER,
} from './map-config.js';
import {
  dressTile,
  drainRgb,
  hexRgb,
  isMuted,
  muteRgb,
  tileColor,
  tileJitter,
} from './map-dressing.js';
import { greyTiles, villageSeeds, villageSquares } from '../hollowed/community-model.js';
import { findHomeBases, hash01, mapBounds, mapRadius } from './map-layout.js';
import { buildProp, buildWildTuft, linear, merged, painted, type PropDetail } from './map-props.js';
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
/**
 * A tile's shape zoomed out (#318), where it's a few dozen pixels across:
 * the dome and the rim, corners barely rounded. The top lands where the full shape's
 * does. About a fifth of the full shape's triangles.
 */
const FAR_TOP_RINGS: readonly ProfileRing[] = [
  { scale: 0.8, y: DOME * 0.25 },
  { scale: 1, y: -BEVEL },
];
const FAR_SEGMENTS = 2;
/** Overlays (selection, safe glow, homesteads) float this far above the tile so they never z-fight. */
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
  /** Home tiles saved for a Keeper who hasn't joined yet, drawn as a dashed outline (#318). */
  readonly openHomeTiles: number;
  /** Hollowed village tiles drawn grey (#306), outlined in lavender (one mesh for all). */
  readonly hollowedTiles: number;
  readonly homes: number;
  readonly claimedHomes: number;
  /** Meshes drawing tiles: one per terrain look in use, plus home tiles. */
  readonly tileMeshes: number;
  /** Keepers standing at their home bases (#42). */
  readonly keepers: number;
  /** Buildings on home bases (#18), and the Hearthfires among them drawn lit. */
  readonly buildings: number;
  readonly litFires: number;
  /** Lit porch lanterns by patch-mates' Heart Seeds (#515), not counted above. */
  readonly porchLanterns: number;
  /** Fence segments on hex edges (#203). */
  readonly fences: number;
  /** Tiles under a lit Hearthfire's soft glow (its safe radius, #18). */
  readonly safeTiles: number;
  /** Clothing ids each drawn Keeper wears (#43), by drawing order. */
  readonly keepersWearing: readonly (readonly string[])[];
  /** Dressing props on the map, and how many kinds (one draw call each). */
  readonly props: number;
  readonly propKinds: number;
  /**
   * How tiles and props draw (#318): `near` at high detail, or `far`
   * (zoomed out) from low-detail meshes, the same number of draw calls.
   */
  readonly detail: 'near' | 'far';
  /** Draw calls in the last frame drawn, and the triangles its meshes in view drew (#318). */
  readonly drawCalls: number;
  readonly activeTriangles: number;
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
  /** Homestead tiles (#199): joined to home, and napping (cut off). */
  readonly homesteads: number;
  readonly pausedHomesteads: number;
  /** Fully explored tiles wearing a sparkle (#199). */
  readonly explored: number;
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

/** What a tile is drawn as: home land, or its terrain. */
const shapeOf = (tile: PublicTile): string => (tile.homeSlot !== null ? 'home' : tile.terrain);

/** The look whose tile mesh draws this tile: its own, or the one it borrows (`meshOf`). */
function meshLookOf(tile: PublicTile): TerrainLook {
  const look = lookOf(tile);
  return look.meshOf !== undefined ? (TERRAIN_LOOKS[look.meshOf] ?? look) : look;
}

/** sRGB (0–1) to linear, as Babylon's `toLinearSpace` does. */
const toLinear = (v: number): number => Math.pow(v, 2.2);

/** Height of a tile's top: its look's, plus its own small wobble (none on home tiles). */
/** A tile's top surface height, world units (layers that sit on a tile use it). */
export function topOf(tile: PublicTile): number {
  const look = lookOf(tile);
  return tile.homeSlot !== null ? look.height : look.height + tileJitter(tile, tile.terrain).height;
}

/**
 * A tile instance's placement on a mesh lofted at `height`: the height
 * wobble scales it, so its top lands at `topOf(tile)`.
 */
function tileMatrix(tile: PublicTile, height: number): Matrix {
  const p = hexToWorld(tile, HEX_SIZE);
  return placeAt(p.x, 0, p.z, new Vector3(1, (topOf(tile) + DOME) / (height + DOME), 1));
}

/** One instanced tile mesh and the tiles it draws, for recolouring when ownership changes. */
interface TileGroup {
  readonly mesh: Mesh;
  /** The same tiles at low detail, for the zoomed-out map (#318). */
  readonly far: Mesh;
  readonly look: TerrainLook;
  readonly tiles: PublicTile[];
  /** Grows when land turns home (`adoptHomes`). */
  colors: Float32Array;
  /** How muted each tile is drawn: 1 on wild land, part way on land that misses its owner. */
  readonly muted: number[];
  /** Each tile's shape as last drawn (`shapeOf`: a clear, #242, or a won ring, #306, changes it). */
  readonly terrains: string[];
}

/** One prop kind's instances, for re-muting when ownership changes. */
interface PropGroup {
  readonly mesh: Mesh;
  /** Each instance's tile key. */
  readonly tiles: HexKey[];
  /** `terrainAmbient` per instance: sway, phase, muted, bob. */
  readonly ambient: Float32Array;
  /** The same instances at low detail, for the zoomed-out map (#318). */
  readonly far: Mesh;
  /** Each instance's placement as built, so props can come back after being cleared away. */
  readonly base: Matrix[];
}

/** A prop's instance on a tile that a building fills or that was cleared (#295): drawn at nothing. */
const GONE = Matrix.Scaling(0, 0, 0);

/** A tile's shape in its old terrain mesh once it moved into the home mesh (`adoptHomes`). */
const MOVED_HOME = 'moved-home';

/** `placements` with every one on a `cleared` tile (by `tiles`, index for index) drawn at nothing. */
function hideOn(
  placements: readonly Matrix[],
  tiles: readonly HexKey[],
  cleared: ReadonlySet<HexKey>,
): Matrix[] {
  return placements.map((m, i) => {
    const key = tiles[i];
    return key !== undefined && cleared.has(key) ? GONE : m;
  });
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
  /** Hollowed village tiles (#306), drawn grey; and each village's square, by kind. */
  private grey = new Set<HexKey>();
  private squares = new Map<HexKey, CommunityKindId>();
  /** Whose land is whose (#278): a wash, a ribbon on the outer edges, and icons. */
  private readonly borders: BorderField;
  private readonly seedMesh: Mesh;
  private readonly plotMesh: Mesh;
  private readonly selection: Mesh;
  /** Each member's Keeper by their Heart Seed (design doc §23). Low detail; never animates here. */
  private readonly keepers: KeeperField;
  /** Fires and habitats on home bases (#18), at map scale. */
  private readonly buildings: BuildingField;
  /** The view's buildings as last placed (`update`), before any porch lanterns. */
  private placed: BuildingPlacement[] = [];
  /** Patch-mates whose porch lantern is lit (#515, `setPorchLanterns`). */
  private porches: ReadonlySet<string> = new Set();
  private porchCount = 0;
  /** Fence segments along tile edges (#203). */
  private readonly fences: FenceField;
  /** What the Build sheet lights on a tile (#371). */
  private readonly buildArea: BuildAreaField;
  /** The soft glow over tiles a lit Hearthfire keeps safe (#18). */
  private readonly safeGlow: Mesh;
  /** Homestead glows (#199): joined, then napping. */
  private readonly homesteadGlow: Mesh;
  private readonly pausedGlow: Mesh;
  private readonly exploredMark: Mesh;
  /** The player's home node the tutorial points at (`homeNodeRect`), until `update`. */
  private homeNode: { userId: string | null; tile: PublicTile | null } | null = null;
  /** Resource nodes drawn on home bases (`buildHomeNodes`). */
  private readonly homeNodes: number;
  private readonly nodeField: HomeNodes;
  private tileMeshes = 0;
  private counts = {
    homes: 0,
    claimedHomes: 0,
    safeTiles: 0,
    homesteads: 0,
    pausedHomesteads: 0,
    explored: 0,
  };
  /** My land that misses me: how far each tile has faded (0–1), by tile. */
  private landFade = new Map<HexKey, number>();
  /** Ambient time: every terrain material reads it (terrain-plugin.ts). */
  private readonly clock = new TerrainClock();
  private readonly halloween: boolean;
  private readonly tileGroups: TileGroup[] = [];
  private readonly propGroups: PropGroup[] = [];
  private propCount = 0;
  /** Contact shadows under the props; up close only (#318). */
  private propShadows: Mesh | null = null;
  /** Each prop shadow's placement as built, and its tile (`clearProps`). */
  private shadowBase: Matrix[] = [];
  private readonly shadowTiles: HexKey[] = [];
  /** Tiles whose props are cleared away now (`clearProps`). */
  private propsCleared = new Set<HexKey>();
  /** Each tile's terrain when the map was built: a tile cleared since loses its props (#242). */
  private readonly builtTerrain = new Map<HexKey, string>();
  /** Land that moved into the home tile mesh (`adoptHomes`): its index there. */
  private readonly adopted = new Map<HexKey, number>();
  /** Tiles that were home land when the props were built (they have none). */
  private readonly builtHome = new Set<HexKey>();
  /** Zoomed out: tiles and props draw from their low-detail meshes (`followZoom`). */
  private far = false;
  private readonly instrumentation: SceneInstrumentation;
  /** Draw calls in the last frame drawn (`SceneInstrumentation`, as the battle measures). */
  private drawCalls = 0;
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
    this.grey = greyTiles(view);
    this.squares = villageSquares(view);
    this.bounds = mapBounds(view.tiles, HEX_SIZE);

    this.instrumentation = new SceneInstrumentation(scene);
    // After the camera has moved for this frame (the map camera moves in
    // its own before-render step, and Babylon refreshes the camera's
    // position in `updateTransformMatrix`) and before the meshes to draw are
    // picked, so the frame that crosses the switch draws the new detail. On
    // demand, that's often the last frame drawn.
    const zoom = scene.onBeforeCameraRenderObservable.add(() => {
      this.followZoom();
    });
    const counted = scene.onAfterRenderObservable.add(() => {
      this.drawCalls = this.instrumentation.drawCallsCounter.current;
    });
    scene.onDisposeObservable.addOnce(() => {
      scene.onBeforeCameraRenderObservable.remove(zoom);
      scene.onAfterRenderObservable.remove(counted);
      this.instrumentation.dispose();
    });

    this.buildIsland(view.tiles);
    this.animated = this.buildTiles(view.tiles);
    for (const t of view.tiles) {
      this.builtTerrain.set(hexKey(t), t.terrain);
      if (t.homeSlot !== null) this.builtHome.add(hexKey(t));
    }
    this.buildProps(view.tiles);
    this.applyDetail();
    this.nodeField = new HomeNodes(scene, view.tiles, new Set(options.seasons ?? []));
    this.homeNodes = this.nodeField.count;
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
    this.buildArea = new BuildAreaField(scene, (name) => overlayMaterial(scene, name));
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
    this.homesteadGlow = buildTileGlow(scene, 'homestead-glow', HOMESTEAD_GLOW.joined);
    this.pausedGlow = buildTileGlow(scene, 'homestead-paused-glow', HOMESTEAD_GLOW.paused);
    this.exploredMark = buildSparkle(scene);
    this.exploredMark.material = vinyl(scene, 'explored-mark-mat', { color: '#ffffff' });
    setInstances(this.exploredMark, []);

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
      openHomeTiles: this.borders.stats.openHomeTiles,
      hollowedTiles: this.grey.size,
      keepers: this.keepers.handles.length,
      // A porch lantern isn't one of the view's buildings, nor a fire.
      buildings: this.buildings.stats.buildings - this.porchCount,
      litFires: this.buildings.stats.lit - this.porchCount,
      porchLanterns: this.porchCount,
      fences: this.fences.count,
      keepersWearing: this.keepers.handles.map((h) => h.params.worn),
      props: this.propCount,
      propKinds: this.propGroups.length,
      detail: this.far ? 'far' : 'near',
      mutedTiles: this.tileGroups.reduce((n, g) => n + g.muted.filter((m) => m === 1).length, 0),
      mutedProps: this.propGroups.reduce(
        (n, g) => n + g.ambient.filter((v, i) => i % 4 === 2 && v === 1).length,
        0,
      ),
      drawCalls: this.drawCalls,
      activeTriangles: activeTriangles(this.scene),
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

  /**
   * Where each open home's Heart Seed spot is on screen (#318): a home slot
   * nobody has joined, its middle tile. For the dev hook (e2e taps it).
   */
  openHomeRects(): { key: HexKey; rect: ScreenRect }[] {
    const tiles = [...this.tiles.values()];
    const open = new Set(
      tiles.filter((t) => t.homeSlot !== null && t.ownerUserId === null).map((t) => t.homeSlot),
    );
    return findHomeBases(tiles)
      .filter((home) => open.has(home.slot))
      .flatMap(({ seed }) => {
        const rect = tileScreenRectOf(this.scene, seed);
        return rect ? [{ key: hexKey(seed), rect }] : [];
      });
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

  /**
   * Trick-or-treat (#515): these Keepers have a lit Jack-o'-Lantern tonight,
   * so a little one glows on their Heart Seed's porch. It's one more thin
   * instance of the level-1 lit lantern and its light pool: no new
   * materials, and no new meshes while a level-1 lantern is on the map (else
   * that one model, built once and shared by every porch).
   */
  setPorchLanterns(userIds: ReadonlySet<string>): void {
    if (userIds.size === this.porches.size && [...userIds].every((id) => this.porches.has(id))) {
      return;
    }
    this.porches = new Set(userIds);
    this.drawBuildings();
  }

  /** The view's buildings plus a porch lantern by each lit Heart Seed. */
  private drawBuildings(): void {
    const porches: BuildingPlacement[] = [];
    if (this.porches.size > 0) {
      for (const home of findHomeBases([...this.tiles.values()])) {
        const owner = home.seed.ownerUserId;
        if (owner === null || !this.porches.has(owner)) continue;
        const p = hexToWorld(home.seed, HEX_SIZE);
        porches.push({
          buildingId: TRICK_OR_TREAT.lanternBuildingId,
          lit: true,
          x: p.x + PORCH_LANTERN.offset.x,
          z: p.z + PORCH_LANTERN.offset.z,
          y: topOf(home.seed) + DOME * 0.5,
          scale: HEX_SIZE * PORCH_LANTERN.scale,
        });
      }
    }
    this.buildings.set([...this.placed, ...porches]);
    this.porchCount = porches.length;
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
    // Villages came to an older map (#306), or one was won: recolour them
    // all. (Their squares' ruins are built with the props, on the next open.)
    const grey = greyTiles(view);
    const regrey = grey.size !== this.grey.size || [...grey].some((k) => !this.grey.has(k));
    this.grey = grey;
    this.squares = villageSquares(view);
    const adopted = this.adoptHomes();
    this.recolour(regrey || adopted);
    this.clearProps();
    this.homeNode = null;
    this.borders.set(
      this.tiles.values(),
      view.members,
      [...grey].flatMap((k) => this.tiles.get(k) ?? []),
    );

    const homes = findHomeBases([...this.tiles.values()]);
    const seeds: Matrix[] = [];
    const plots: Matrix[] = [];
    for (const home of homes) {
      const p = hexToWorld(home.seed, HEX_SIZE);
      if (home.seed.ownerUserId === null) plots.push(placeAt(p.x, HOME_LOOK.height + 0.02, p.z));
      else seeds.push(placeAt(p.x, HOME_LOOK.height + 0.15, p.z));
    }
    // A won village's own Heart Seed on its square (#306 PR 3): one more
    // instance of the same mesh, so no new draw call or material.
    for (const village of villageSeeds(view)) {
      const p = hexToWorld(village.square, HEX_SIZE);
      seeds.push(placeAt(p.x, HOME_LOOK.height + 0.15, p.z));
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
    this.placed = mapBuildings(view, HEX_SIZE).map(({ tile, building, at, fills }) => ({
      buildingId: building.buildingId,
      level: building.level,
      lit: building.lit,
      x: at.x,
      z: at.z,
      y: topOf(tile) + DOME * 0.5,
      scale:
        HEX_SIZE *
        (tile.homeSlot !== null && !fills
          ? MAP_BUILDING_SCALE
          : building.kind === 'hearthfire'
            ? MAP_OUTER_FIRE_SCALE
            : MAP_OUTER_BUILDING_SCALE),
    }));
    this.nodeField.set(view);
    this.drawBuildings();
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
    // Homesteads and fully explored land (#199), as the server worked them out.
    const joined: Matrix[] = [];
    const napping: Matrix[] = [];
    const explored: Matrix[] = [];
    const mark = new Vector3(EXPLORED_MARK.scale, EXPLORED_MARK.scale, EXPLORED_MARK.scale);
    for (const tile of this.tiles.values()) {
      const p = hexToWorld(tile, HEX_SIZE);
      if (tile.homestead === 'joined') joined.push(placeAt(p.x, topOf(tile) + TINT_LIFT * 2, p.z));
      if (tile.homestead === 'paused') napping.push(placeAt(p.x, topOf(tile) + TINT_LIFT * 2, p.z));
      if (tile.explored === true) {
        explored.push(
          placeAt(
            p.x + EXPLORED_MARK.offset.x,
            topOf(tile) + DOME * 0.5,
            p.z + EXPLORED_MARK.offset.z,
            mark,
          ),
        );
      }
    }
    setInstances(this.homesteadGlow, joined, true);
    setInstances(this.pausedGlow, napping, true);
    setInstances(this.exploredMark, explored, true);
    this.counts = {
      homes: homes.length,
      claimedHomes: seeds.length,
      safeTiles: safe.length,
      homesteads: joined.length,
      pausedHomesteads: napping.length,
      explored: explored.length,
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

  /** Lights the edges or middle the Build sheet offers on a tile, or puts them out (null). */
  showBuildArea(view: Omit<BuildAreaView, 'top'> | null): void {
    this.buildArea.set(view ? { ...view, top: topOf(view.tile) } : null);
  }

  /** The edge or middle of the lit tile under a point on the canvas, if any. */
  pickBuildArea(x: number, y: number): BuildAreaHit | null {
    const tile = this.buildArea.shown;
    const camera = this.scene.activeCamera;
    if (!tile || !camera) return null;
    const ray = CreatePickingRay(this.scene, x, y, null, camera);
    if (ray.direction.y >= 0) return null;
    const t = (topOf(tile) - ray.origin.y) / ray.direction.y;
    const p = { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
    return buildAreaAt(tile, p, HEX_SIZE);
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
   * A tile's box on screen (CSS pixels, #419), or null if it isn't on the map
   * or isn't in front of the camera. A tile panned past the edge gives a box
   * off screen: callers check.
   */
  tileRect(h: Hex): ScreenRect | null {
    const tile = this.tiles.get(hexKey(h));
    return tile ? tileScreenRectOf(this.scene, tile) : null;
  }

  /** The tile a building stands on (its instance id), or null if it isn't on this map (#419). */
  buildingTile(id: string): Hex | null {
    for (const tile of this.tiles.values()) {
      if (tile.buildings.some((b) => b.id === id)) return { q: tile.q, r: tile.r };
    }
    return null;
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
   * One mesh per terrain look (plus home tiles; a look with `meshOf` borrows
   * another's, #242), each drawing all its tiles
   * at once. Each tile carries its own colour (a small wobble, muted on wild
   * land) and height wobble in its instance data. True if the terrain plugin
   * runs here (GLSL), so ambient life can move.
   */
  private buildTiles(tiles: readonly PublicTile[]): boolean {
    const groups = new Map<TerrainLook, { key: string; tiles: PublicTile[] }>();
    for (const tile of tiles) {
      const look = meshLookOf(tile);
      let group = groups.get(look);
      if (!group) {
        const terrain = lookOf(tile).meshOf ?? tile.terrain;
        group = { key: tile.homeSlot !== null ? 'home' : terrain, tiles: [] };
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
      const far = meshFrom(
        this.scene,
        `tiles-${group.key}-far`,
        loftRoundedHex(
          TILE_RADIUS,
          [...FAR_TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
          { corner: CORNER, segments: FAR_SEGMENTS, centre: { y: h + DOME } },
        ),
      );
      // White albedo: each tile's colour comes from its instance colour.
      const mat = vinyl(this.scene, `tiles-${group.key}-mat`, { ...look, color: '#ffffff' });
      if (look.glow > 0) mat.emissiveColor = linear(look.color).scale(look.glow);
      const plugin = attachTerrainPlugin(mat, this.clock, { water: group.key === 'lake' });
      if (!plugin) animated = false;
      const matrices = group.tiles.map((tile) => tileMatrix(tile, h));
      // Both detail levels share the colours: recolouring one recolours both.
      const colors = new Float32Array(group.tiles.length * 4);
      for (const m of [mesh, far]) {
        m.material = mat;
        setInstances(m, matrices);
        m.thinInstanceSetBuffer('color', colors, 4, false);
        m.freezeWorldMatrix();
      }
      this.tileGroups.push({
        mesh,
        far,
        look,
        tiles: group.tiles,
        colors,
        muted: group.tiles.map(() => 0),
        terrains: group.tiles.map(shapeOf),
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

  /**
   * Land that turned home since the map was built (a won village's ring,
   * #306 PR 3) moves into the home tile mesh, so it looks exactly like home
   * (its height, colour, wash and glow): its instance in its terrain's mesh
   * shrinks to nothing, and the home mesh gets one more. A ring its winner
   * left (it stops being home) moves back the same way. No new mesh or
   * material. True if anything moved.
   */
  private adoptHomes(): boolean {
    const home = this.tileGroups.find((g) => g.look === HOME_LOOK);
    if (!home) return false;
    let moved = false;
    const added: PublicTile[] = [];
    for (const group of this.tileGroups) {
      if (group === home) continue;
      for (const [i, stale] of group.tiles.entries()) {
        const key = hexKey(stale);
        const tile = this.tiles.get(key);
        if (!tile) continue;
        const isHome = tile.homeSlot !== null;
        const there = group.terrains[i] === MOVED_HOME;
        if (isHome === there) continue;
        moved = true;
        const homeIndex = this.adopted.get(key);
        if (isHome) {
          group.terrains[i] = MOVED_HOME;
          // Drawn in the home mesh now: not counted as muted here.
          group.muted[i] = -1;
          if (homeIndex === undefined) {
            this.adopted.set(key, home.tiles.length + added.length);
            added.push(tile);
          } else {
            // Home again (won back): its home instance shows again.
            home.terrains[homeIndex] = shapeOf(tile);
            home.muted[homeIndex] = -1;
          }
        } else {
          // Not home any more: back in its terrain's mesh, its home instance at nothing.
          group.terrains[i] = shapeOf(tile);
          group.muted[i] = -1;
          if (homeIndex !== undefined) home.terrains[homeIndex] = MOVED_HOME;
        }
      }
    }
    if (!moved) return false;
    if (added.length > 0) {
      const colors = new Float32Array((home.tiles.length + added.length) * 4);
      colors.set(home.colors);
      home.colors = colors;
      for (const tile of added) {
        home.tiles.push(tile);
        // Coloured by the forced recolour that follows.
        home.muted.push(-1);
        home.terrains.push(shapeOf(tile));
      }
    }
    for (const group of this.tileGroups) this.placeTiles(group);
    if (added.length > 0) {
      for (const mesh of [home.mesh, home.far]) {
        mesh.thinInstanceSetBuffer('color', home.colors, 4, false);
      }
    }
    return true;
  }

  /**
   * Writes a tile group's whole matrix buffer again, from each tile as it is
   * now (a moved one at nothing). The buffers are static, so a single
   * instance's matrix written on its own never reaches the GPU.
   * `clearProps` hands the detail back to the zoom after (`applyDetail`).
   */
  private placeTiles(group: TileGroup): void {
    const matrices = group.tiles.map((stale, i) =>
      group.terrains[i] === MOVED_HOME
        ? GONE
        : tileMatrix(this.tiles.get(hexKey(stale)) ?? stale, group.look.height),
    );
    setInstances(group.mesh, matrices);
    setInstances(group.far, matrices);
  }

  /** Recolours tiles and props whose wildness changed (all of them with `force`). */
  private recolour(force = false): void {
    if (this.tileGroups.length === 0) return;
    const wild = new Map<HexKey, number>();
    for (const group of this.tileGroups) {
      let changed = false;
      let moved = false;
      for (const [i, stale] of group.tiles.entries()) {
        // Moved into the home mesh (`adoptHomes`): drawn there now.
        if (group.terrains[i] === MOVED_HOME) continue;
        const key = hexKey(stale);
        const tile = this.tiles.get(key) ?? stale;
        const fading = tile.homeSlot === null ? (this.landFade.get(key) ?? 0) : 0;
        const muted = isMuted(tile) ? 1 : Math.min(1, Math.max(0, fading)) * LAND_FADE.most;
        wild.set(key, muted);
        // A clear (#242) changes a tile's terrain, and a won village's ring
        // (#306 PR 3) makes land home: its colour and height follow, so what
        // stands on it (`topOf`) sits on its top. Same mesh, new instance data.
        const reshaped = group.terrains[i] !== shapeOf(tile);
        if (!force && group.muted[i] === muted && !reshaped) continue;
        group.muted[i] = muted;
        group.terrains[i] = shapeOf(tile);
        if (reshaped) moved = true;
        changed = true;
        const c =
          tile.homeSlot !== null
            ? tileColor(lookOf(tile).color, { brightness: 1, warmth: 0, height: 0 }, muted)
            : tileColor(lookOf(tile).color, tileJitter(tile, tile.terrain), muted);
        // A Hollowed village (#306): drained past wild, in its own instance colour.
        const drawn = this.grey.has(key) ? drainRgb(c) : c;
        group.colors.set([...drawn.map(toLinear), 1], i * 4);
      }
      if (moved) {
        this.placeTiles(group);
        this.applyDetail();
      }
      if (changed) {
        group.mesh.thinInstanceBufferUpdated('color');
        group.far.thinInstanceBufferUpdated('color');
      }
    }
    for (const group of this.propGroups) {
      let changed = false;
      for (const [i, key] of group.tiles.entries()) {
        const muted = wild.get(key) ?? 0;
        if (group.ambient[i * 4 + 2] === muted) continue;
        group.ambient[i * 4 + 2] = muted;
        changed = true;
      }
      if (changed) {
        group.mesh.thinInstanceBufferUpdated(AMBIENT_ATTRIBUTE);
        group.far.thinInstanceBufferUpdated(AMBIENT_ATTRIBUTE);
      }
    }
  }

  /**
   * Dressing for every terrain tile (map-dressing.ts): one thin-instanced
   * mesh per prop kind, each instance with its colour multiplier and its
   * sway, phase, muted and bob values (terrain-plugin.ts). Each kind is built
   * twice (#318), at high detail for the near camera and at low detail for
   * the zoomed-out map; `applyDetail` shows one, so draw calls stay the same.
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
      const nodeProp: PropKind | undefined = isTradingPost(tile)
        ? 'trading-post'
        : node !== null && LAND_NODES.has(node)
          ? NODE_PROPS[node]
          : undefined;
      // A Hollowed village's square (#306): its kind's broken building and
      // ruins round it (a node there keeps its spot in the middle).
      const square = this.squares.get(key);
      const middle = nodeProp ?? (square ? HOLLOWED_SQUARE[square] : undefined);
      const dressing = dressTile(tile, square ? `hollowed-${square}` : tile.terrain, HEX_SIZE, {
        halloween: this.halloween,
        ...(middle !== undefined && { middle }),
      });
      const drained = this.grey.has(key) ? hexRgb(HOLLOWED_LOOK.props) : null;
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
        // Props in a Hollowed village are drained too (#306).
        kind.tints.push(...hexRgb(prop.tint).map((v, i) => toLinear(v * (drained?.[i] ?? 1))), 1);
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
          this.shadowTiles.push(key);
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
      let mat: Material = propMat;
      if (kindName === 'jack-o-lantern') {
        this.lanternMat = glowing('lantern-mat', HALLOWEEN.glowColor, HALLOWEEN.glow.day);
        mat = this.lanternMat;
      } else if (kindName === 'crystal') {
        mat = glowing('crystal-mat', CRYSTAL_GLOW.color, CRYSTAL_GLOW.strength);
      }
      // Both detail levels share the instance data: muting one mutes both.
      const tints = new Float32Array(kind.tints);
      const ambient = new Float32Array(kind.ambient);
      const far = buildProp(this.scene, kindName, 'low').mesh;
      far.name = `${kindName}-far`;
      const detail: Record<PropDetail, Mesh> = { high: mesh, low: far };
      for (const m of Object.values(detail)) {
        m.material = mat;
        setInstances(m, kind.matrices);
        m.thinInstanceSetBuffer('color', tints, 4, true);
        m.thinInstanceSetBuffer(AMBIENT_ATTRIBUTE, ambient, 4, false);
        m.freezeWorldMatrix();
      }
      this.propGroups.push({ mesh, far, tiles: kind.tiles, ambient, base: kind.matrices });
      this.propCount += kind.matrices.length;
    }

    // Baked soft contact shadows: one round, vertex-alpha disc per prop. Only
    // up close: zoomed out they're specks, and there are as many as props.
    this.propShadows = meshFrom(
      this.scene,
      'prop-shadows',
      loftRoundedHex(1, [{ scale: 1, y: 0, alpha: 0 }], {
        corner: Math.sqrt(3) / 2, // fully rounded: a circle
        segments: 6,
        centre: { y: 0, alpha: 0.35 }, // TUNE
        rgb: [0.42, 0.29, 0.43],
      }),
    );
    this.propShadows.material = overlayMaterial(this.scene, 'prop-shadow-mat');
    setInstances(this.propShadows, shadows);
    this.propShadows.freezeWorldMatrix();
    this.shadowBase = shadows;
  }

  /**
   * Clears the props (and their shadows) off tiles a building fills or that
   * were cleared since the map was built (#295, #242: "buildings fill their
   * tile, with its props cleared away"); a tile that loses its building gets
   * them back. Home tiles carry no props. Only rewrites a kind's instances
   * when its cleared set changed.
   */
  private clearProps(): void {
    const cleared = new Set<HexKey>();
    for (const [key, tile] of this.tiles) {
      // Home land has no props: a won village's ring (#306 PR 3) loses its ruins.
      if (tile.homeSlot !== null) {
        if (!this.builtHome.has(key)) cleared.add(key);
        continue;
      }
      const wasCleared = this.builtTerrain.get(key) !== tile.terrain;
      if (tile.buildings.length > 0 || wasCleared) cleared.add(key);
    }
    const same =
      cleared.size === this.propsCleared.size &&
      [...cleared].every((k) => this.propsCleared.has(k));
    if (same) return;
    this.propsCleared = cleared;
    for (const group of this.propGroups) {
      const matrices = hideOn(group.base, group.tiles, cleared);
      setInstances(group.mesh, matrices);
      setInstances(group.far, matrices);
    }
    if (this.propShadows) {
      setInstances(this.propShadows, hideOn(this.shadowBase, this.shadowTiles, cleared));
    }
    // `setInstances` turned both details on: back to the one the zoom shows.
    this.applyDetail();
  }

  /**
   * Shows the near (high-detail) or far (low-detail) tiles and props for the
   * camera's height (#318), with some give either side of
   * `MAP_DETAIL.farHeight` so a pinch near it never flickers.
   */
  private followZoom(): void {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const height = camera.globalPosition.y;
    const { farHeight, hysteresis } = MAP_DETAIL;
    const far = this.far ? height > farHeight - hysteresis : height > farHeight + hysteresis;
    if (far === this.far) return;
    this.far = far;
    this.applyDetail();
  }

  private applyDetail(): void {
    const near = !this.far;
    for (const g of [...this.tileGroups, ...this.propGroups]) {
      g.mesh.setEnabled(near);
      g.far.setEnabled(!near);
    }
    // A mesh with no instances stays off (`setInstances`).
    this.propShadows?.setEnabled(near && this.propShadows.thinInstanceCount > 0);
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

/**
 * A soft glow over a tile's middle (homesteads, #199): a bright ring
 * inside the owner's border, so the tile's colour and border still show.
 */
export function buildTileGlow(
  scene: Scene,
  name: string,
  look: { readonly rgb: readonly number[]; readonly fill: number; readonly edge: number },
): Mesh {
  const mesh = meshFrom(
    scene,
    name,
    loftRoundedHex(
      TILE_RADIUS,
      [
        // Brightest in a ring, then gone before the owner's border ribbon
        // (#278, `BORDER.ribbon.inner`), so its line style and icon still show.
        { scale: 0.5, y: DOME * 0.75, alpha: look.fill },
        { scale: 0.66, y: DOME * 0.5, alpha: look.edge },
        { scale: 0.8, y: DOME * 0.25, alpha: 0 },
      ],
      {
        corner: CORNER,
        segments: SEGMENTS,
        centre: { y: DOME, alpha: look.fill },
        rgb: [look.rgb[0] ?? 1, look.rgb[1] ?? 1, look.rgb[2] ?? 1],
      },
    ),
  );
  mesh.material = overlayMaterial(scene, `${name}-mat`);
  setInstances(mesh, []);
  return mesh;
}

/** A little gold four-point sparkle on a fully explored tile (#199), about 0.12 across. */
function buildSparkle(scene: Scene): Mesh {
  const ray = (sx: number, sy: number) => {
    const m = CreateSphere('sparkle-part', { diameter: 0.12, segments: 6 }, scene);
    m.scaling.set(sx, sy, 0.3);
    m.position.y = 0.09;
    return painted(m, '#ffd166');
  };
  return merged('explored-sparkle', [ray(0.28, 1), ray(1, 0.28)]);
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

/**
 * Draws every home node, one instanced mesh per prop kind. A tile whose
 * building fills it (#589) shows its node as a small pile at the tile's edge;
 * it is the same mesh, so no new draw calls.
 */
class HomeNodes {
  readonly count: number;
  readonly #kinds = new Map<PropKind, Mesh>();
  readonly #seasons: ReadonlySet<string>;

  constructor(scene: Scene, tiles: readonly PublicTile[], seasons: ReadonlySet<string>) {
    this.#seasons = seasons;
    let count = 0;
    for (const tile of tiles) {
      const kind = this.#kindOf(tile);
      if (!kind) continue;
      count++;
      if (this.#kinds.has(kind)) continue;
      const mat = vinyl(scene, 'home-node-mat', { color: '#ffffff' });
      mat.freeze();
      const { mesh } = buildProp(scene, kind);
      mesh.name = `home-node-${kind}`;
      mesh.material = mat;
      mesh.freezeWorldMatrix();
      this.#kinds.set(kind, mesh);
    }
    this.count = count;
  }

  #kindOf(tile: PublicTile): PropKind | null {
    const node = tile.homeSlot !== null ? tile.nodeResource : null;
    return node && homeNodeShown(node, this.#seasons) ? (NODE_PROPS[node] ?? null) : null;
  }

  /** Places the nodes for this view: in the tile's middle, or aside where a building fills it. */
  set(view: MapView): void {
    if (this.#kinds.size === 0) return;
    const filled = filledTiles(view);
    const byKind = new Map<PropKind, Matrix[]>();
    const small = new Vector3(HOME_FILL.nodeScale, HOME_FILL.nodeScale, HOME_FILL.nodeScale);
    for (const tile of view.tiles) {
      const kind = this.#kindOf(tile);
      if (!kind) continue;
      const centre = hexToWorld(tile, HEX_SIZE);
      const aside = filled.has(hexKey(tile));
      const p = aside ? nodeAside(centre, HEX_SIZE) : centre;
      const list = byKind.get(kind) ?? [];
      list.push(placeAt(p.x, HOME_LOOK.height + DOME * 0.5, p.z, aside ? small : undefined));
      byKind.set(kind, list);
    }
    for (const [kind, mesh] of this.#kinds) setInstances(mesh, byKind.get(kind) ?? []);
  }
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
