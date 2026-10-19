import { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  KEEPER_DATA,
  type ExploreTileResponse,
  type KeeperConfig,
  type PublicSearchSpot,
  type PublicTile,
  type ToolId,
  type WorldPoint,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { countGl, type CountedGl, type GlCounts } from '../engine/gl-counters.js';
import { ExploreSky, type ExploreSkyStats } from './explore-sky.js';
import { ExploreLand, type LandStats } from './explore-land.js';
import { ExploreWater, lakeExtras, type WaterStats } from './explore-water.js';
import { LAKE_LOOKS, WATER_LOOKS_BY_TERRAIN } from './lake-config.js';
import { LAND_LOOKS } from './land-config.js';
import { FRAME_CAP_30, type QualityTier } from '../engine/config.js';
import {
  AmbientJudge,
  ambientMode,
  type AmbientMode,
  type AmbientStatus,
} from '../map/ambient-layout.js';
import type { AmbientTarget } from '../map/ambient-driver.js';
import { isUnderwater, type SkyLook } from './explore-sky-look.js';
import { spotWorld } from '../home/home-layout.js';
import {
  AMBIENT,
  FALLBACK_LOOK,
  HEX_SIZE,
  ISLAND,
  TERRAIN_LOOKS,
  TILE_FILL,
  type PropKind,
} from '../map/map-config.js';
import { loftRoundedHex } from '../map/hex-mesh.js';
import { buildLakeSpotProp } from './lake-kit.js';
import { buildSpotProp } from './land-kit.js';
import {
  box,
  cylinderPart,
  disc,
  kitMesh,
  merged,
  painted,
  Part,
  torus,
  uvSphere,
} from './kit-mesh.js';
import { BIOME_EXTRAS, buildBiomeSpot, overridesSpot } from './biome-dressing.js';
import { BIOME_LOOKS } from './biome-looks.js';
import { linear } from '../map/map-props.js';
import {
  buildProp,
  CORNER,
  DOME,
  meshFrom,
  overlayMaterial,
  placeAt,
  SEGMENTS,
  setInstances,
  TOP_RINGS,
  vinyl,
} from '../map/map-scene.js';
import { BuildingField } from '../procedural/buildings/building-field.js';
import { CONTACT_SHADOW, type SquishyLod } from '../procedural/config.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import {
  EXPLORE_CAMERA,
  EXPLORE_FADE,
  EXPLORE_PREWARM,
  EXPLORE_SWIM,
  EXPLORE_UNDERWATER,
  EXPLORE_TOOL,
  EXPLORE_VIEW,
} from './explore-config.js';
import {
  createHop,
  hopActive,
  hopPose,
  shadowAlpha,
  shadowScale,
  stepHop,
  TELEPORT,
  type HopPose,
} from './keeper-hop.js';
import {
  bubblesAt,
  createSwim,
  stepSwim,
  swimActive,
  swimPlacement,
  swimPose,
  type SwimPlacement,
  type SwimPose,
} from './keeper-swim.js';
import { SwimBubbles } from './swim-bubbles.js';
import {
  cameraGoal,
  cameraSettled,
  cameraShot,
  collidersOf,
  coverShare,
  decorPlaces,
  followStep,
  freePoint,
  glintNudge,
  hidingSpots,
  tileSeed,
  tileSurface,
  spotRadius,
  type Collider,
  type DecorKind,
  type FollowCamera,
  type ScreenBox,
} from './explore-world.js';

// The explore view (#199; cozy-sim feel #291, owner mockup 2026-10-08): one
// of my tiles up close, its search spots drawn from the terrain's prop kit
// (the rocks, trees and mounds *are* the spots, and glint until searched),
// grass, pebbles and flowers grown from the tile's seed, its buildings, my
// Keeper with the tool in hand (the team waits at home: #501). A camera
// follows the Keeper, close and tilted. Positions come from the server
// (CLAUDE.md rule 1); the screen moves the Keeper and asks this scene to
// draw it. Render on demand (tech spec §6): an idle tile draws nothing.

/** Read-only numbers for the dev hook (Playwright asserts on these, not pixels). */
export interface ExploreSceneStats {
  readonly spots: number;
  readonly done: number;
  /** Spots still glinting (not searched yet). */
  readonly glints: number;
  readonly buildings: number;
  readonly keeper: boolean;
  /** Prop draw calls (one per kind of spot on the tile). */
  readonly propMeshes: number;
  /** Decor thin instances by kind (one draw call each). */
  readonly decor: Readonly<Record<DecorKind, number>>;
  /** The spot with the soft halo (in front of the Keeper), or null. */
  readonly highlighted: number | null;
  /** The tool in the Keeper's hand, or null. */
  readonly held: ToolId | null;
  /** The camera: tile-local target and zoom (1, or less while nudged in). */
  readonly camera: { readonly x: number; readonly z: number; readonly zoom: number };
  /** Draw calls in the last frame drawn (`SceneInstrumentation`, as the battle measures). */
  readonly drawCalls: number;
  /** Spots faded because they stand between the camera and the Keeper. */
  readonly faded: readonly number[];
  /** How much of the Keeper each faded spot covers on screen, in `faded`'s order (#335). */
  readonly fadedCover: readonly number[];
  /** The Keeper's height on screen, as a share of the canvas's height (0: not on screen). */
  readonly keeperHeight: number;
  /** The sky's pieces (#335). */
  readonly sky: ExploreSkyStats;
  /** Triangles in the last frame drawn (Babylon's active indices ÷ 3). */
  readonly triangles: number;
  /**
   * Meshes, materials, textures and geometries made since the scene opened
   * (#501). Walking and the ambient clock only move what's built, so these
   * stay put while exploring; a rebuild per step would count up here.
   */
  readonly created: {
    readonly meshes: number;
    readonly materials: number;
    readonly textures: number;
    readonly geometries: number;
  };
  /**
   * WebGL buffers made and shader programs linked since the scene opened
   * (#501 D1). The kit's shapes come from the page's cache, so a second build
   * makes only the tile's own buffers; once `warm`, playing (a find, a tool
   * in hand, a fade) links no program. Dev builds only (the `?fps=1` badge
   * counts them there anyway); null otherwise.
   */
  readonly gl: { readonly buffers: number; readonly programs: number } | null;
  /** Every program a mesh shown later needs is compiled (`#prewarm`). */
  readonly warm: boolean;
  /** The land kit's layers and tier (#335 art reset), or null on today's tile. */
  readonly land: LandStats | null;
  /** The lake's own layers (kelp, coral, fish, bubbles), or null off a lake. */
  readonly water: WaterStats | null;
  /**
   * Ambient life (#335): how it runs now, and whether the judge called this
   * device too slow for it (sticky for the visit; a find doesn't count, #501 H).
   */
  readonly ambient: AmbientStatus;
  /**
   * The Keeper's swim under a lake (#399), or null on land: its forward
   * pitch (radians; positive leans into the heading), strokes taken, and
   * kick bubbles rising.
   */
  readonly swim: {
    readonly pitch: number;
    readonly strokes: number;
    readonly moving: boolean;
    readonly bubbles: number;
  } | null;
}

export interface ExploreSceneOptions {
  readonly lod: SquishyLod;
  readonly keeper: KeeperConfig | null;
  readonly keeperWearing?: readonly string[];
  /** The tile as the map knows it: its buildings. */
  readonly mapTile: PublicTile | null;
  /** The sky at the patch's time of day (#335). */
  readonly sky: SkyLook;
  /** The quality tier now (#335: the land's grass share follows it). */
  readonly tier: QualityTier;
  /** Dev captures (`?tier=` pinned): ambient life never switches itself off as too slow. */
  readonly pinned?: boolean;
  /** Reduce Motion: the Keeper bobs instead of hopping (#317). Default off. */
  readonly reducedMotion?: () => boolean;
  /** Draws one more frame (the fade and glints settle after a frame, #335). */
  readonly redraw?: () => void;
}

/** A search spot drawn from the land kit (#335): a biome's own take first, then the meadow's, the lake's, the trail's and the cave's. */
const kitSpot = (scene: Scene, kind: string, terrain: string) =>
  (overridesSpot(terrain, kind) ? buildBiomeSpot(scene, kind, terrain) : null) ??
  buildSpotProp(scene, kind) ??
  buildLakeSpotProp(scene, kind) ??
  buildBiomeSpot(scene, kind, terrain);

/**
 * What each kind of spot looks like: a map prop where one fits, else one of
 * the explore-only shapes built below (a mound, a pond, a ledge, a cave).
 */
const SPOT_PROPS: Readonly<Record<string, PropKind | ExploreShape>> = {
  rock: 'rock',
  tree: 'tree',
  'hollow-log': 'log',
  'flower-bed': 'flowers',
  'pumpkin-row': 'pumpkin',
  reeds: 'reeds',
  mound: 'mound',
  pond: 'pond',
  ledge: 'ledge',
  cave: 'cave',
  // #335: the trail's and the cave's own spots are drawn by their land kit
  // (kitSpot); without one they fall back to a rock.
};

type ExploreShape = 'mound' | 'pond' | 'ledge' | 'cave';

/** The island under the tile: shallow, so the tile reads as a little diorama. */
const ISLAND_DEPTH = 0.12; // TUNE:
const SHAPES: ReadonlySet<string> = new Set<ExploreShape>(['mound', 'pond', 'ledge', 'cave']);
/**
 * Writes a follow-camera shot into a camera, looking along +z and down by
 * `pitch` at `target` from `distance` away, and refreshes its view and
 * projection at once (#335): Babylon otherwise keeps the last frame's
 * matrices until the next render, and anything projected in between (the
 * fade, the glints) would see the old view.
 */
export function writeShot(
  camera: TargetCamera,
  target: Vector3,
  pitch: number,
  distance: number,
): void {
  camera.position.set(
    target.x,
    target.y + Math.sin(pitch) * distance,
    target.z - Math.cos(pitch) * distance,
  );
  camera.setTarget(target);
  camera.getViewMatrix(true);
  camera.getProjectionMatrix(true);
}

const isShape = (kind: PropKind | ExploreShape): kind is ExploreShape => SHAPES.has(kind);
const TOOLS: readonly ToolId[] = ['shovel', 'net', 'rope', 'lantern'];
/** The camera looks at about the Keeper's middle, not its feet (world units). */
const AIM_HEIGHT = 0.5; // TUNE:
/** The Keeper leans back a little so its face reads under the tilted camera. */
const KEEPER_LEAN = 0.06; // TUNE:

/** One kind of spot prop: its instances, and a see-through copy for the ones hiding the Keeper. */
interface PropBatch {
  readonly mesh: Mesh;
  readonly faded: Mesh;
  readonly spots: readonly { readonly index: number; readonly matrix: Matrix }[];
}

// Scratch for the per-frame tool placement (no allocations while walking).
const TOOL_WORLD = new Matrix();
const TOOL_TURN = new Quaternion();
const TOOL_SCALE = new Vector3();
const TOOL_AT = new Vector3();
const TOOL_ANCHOR = new Vector3();
// Scratch for screenOf (the lantern's light asks every frame).
const SCREEN_FROM = new Vector3();
const SCREEN_AT = new Vector3();
const SCREEN_VIEWPORT = new Viewport(0, 0, 1, 1);

// Scratch for the placements (no allocations while walking, #323).
/** Where the camera aims while swimming (#399), tile-local. */
const SWIM_AIM = { x: 0, z: 0 };
/** The swimmer's middle, tile-local, for the sand under its shadow (#399). */
const SWIM_MIDDLE = { x: 0, z: 0 };
const SWIM_PLACE: SwimPlacement = { dx: 0, dz: 0, lean: 0, lift: 0, midX: 0, midZ: 0 };
/** The swim shadow sits this far above the sand (world units), clear of the dunes' ripples. */
const SWIM_SHADOW_LIFT = 0.05; // TUNE:
const SWIM_SHADOW_TURN = Quaternion.Identity();
const PLACE = {
  x: 0,
  z: 0,
  y: 0,
  yaw: 0,
  scale: 1,
  lean: 0,
  lift: 0,
  squash: 1,
  shadow: 1,
  shadowAlpha: 1,
};

export class ExploreScene implements AmbientTarget {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #size = EXPLORE_VIEW.hexSize;
  readonly #k = EXPLORE_VIEW.hexSize / HEX_SIZE;
  /** The tile's top under a tile-local point, world units up (#291: nothing floats at the rim). */
  readonly #surface: (p: WorldPoint) => number;
  readonly #props = new Map<string, PropBatch>();
  /** Glint heights for the spots drawn from the land kit, world units, by spot kind. */
  readonly #kitGlint = new Map<string, number>();
  /** The spots now faded (between the camera and the Keeper). */
  #hiding = new Set<number>();
  #hidingNext = new Set<number>();
  readonly #solidScratch: Matrix[] = [];
  readonly #fadedScratch: Matrix[] = [];
  readonly #heightOf = (kind: string): number => this.#heights.get(kind) ?? 0;
  /** The canvas's box on the page, read once a frame. */
  #box: DOMRect | null = null;
  /** Prop heights by spot kind, tile-local (for the fade). */
  readonly #heights = new Map<string, number>();
  #aspect = 0;
  #shot = cameraShot(0.5);
  #decor: Record<DecorKind, number>;
  readonly #glints: Mesh;
  /** The settled shot the fade and glints were last worked out for (`#framingKey`). */
  #framed = '';
  /** Each open spot's glint's x, as last drawn (redrawn only when one moves). */
  #glintNudge: number[] = [];
  readonly #halo: Mesh;
  readonly #tools: Record<ToolId, Mesh>;
  readonly #colliders: Collider[];
  readonly #buildings: BuildingField;
  readonly #keepers: KeeperField;
  readonly #instrumentation: SceneInstrumentation;
  readonly #beforeRender: Observer<Scene>;
  readonly #afterRender: Observer<Scene>;
  readonly #lookAt = new Vector3();
  #keeper: KeeperHandle | null = null;
  /** The Keeper's hop (#317), its pose this frame, and the ground covered since the last step. */
  readonly #hop = createHop();
  readonly #pose: HopPose = { lift: 0, squash: 1 };
  #walked = 0;
  /** Someone was hopping, landing, settling or swimming at the last step. */
  #posing = false;
  readonly #reduced: () => boolean;
  /** Asks the screen for one more frame. */
  readonly #redraw: () => void;
  /** The side each spot's glint last slid to, so it doesn't flip while the Keeper walks past. */
  readonly #glintSide = new Map<number, number>();
  #tile: ExploreTileResponse;
  #at: WorldPoint = EXPLORE_VIEW.start;
  #yaw: number = EXPLORE_VIEW.startYaw;
  #highlighted: number | null = null;
  #held: ToolId | null = null;
  /** When the tool's last swing started (ms), or null. */
  #swingAt: number | null = null;
  #swing = 0;
  /** The spot a tool is being used on (the camera leans in on it), or null. */
  #focus: WorldPoint | null = null;
  /** The lantern is lit: the camera follows the Keeper and its light (board g). */
  #lit = false;
  #camera: FollowCamera;
  #lastStep: number | null = null;
  readonly #sky: ExploreSky;
  /** The land kit (#335 art reset), on the terrains built on it so far; null: today's tile. */
  readonly #land: ExploreLand | null = null;
  /** The lake's water life on that land (#335), underwater only. */
  readonly #water: ExploreWater | null = null;
  /** Ambient life (#335): how it runs, and whether the device keeps up with it. */
  #ambient: AmbientMode = 'off';
  #ambientStart: number | null = null;
  readonly #judge = new AmbientJudge();
  /** `expectHitch` calls (`ambientStatus`). */
  #hitches = 0;
  readonly #pinned: boolean;
  #triangles = 0;
  /** The ground and its decor, tinted by the time of day (#335: moonlit at night). */
  readonly #ground: { readonly mat: PBRMaterial; readonly base: Color3 }[] = [];
  #drawCalls = 0;
  /** Under a lake (#335): the Keeper swims and wears the Snorkel's mask. */
  readonly #underwater: boolean;
  /** The Snorkel's mask on the Keeper's face, underwater. */
  #mask: Mesh | null = null;
  /** The Keeper's swim (#399), its pose this frame, and the bubbles each kick puffs. */
  readonly #swim = createSwim();
  readonly #swimPose: SwimPose = { pitch: 0, lift: 0, squash: 1, surge: 0 };
  #bubbles: SwimBubbles | null = null;
  /** The swimmer's soft shadow under its middle (#399), and its matrix. */
  #swimShadow: Mesh | null = null;
  readonly #swimShadowMatrix = new Float32Array(16);
  /** The high tier's swim extra (#399): kick bubbles. */
  #highTier = false;
  #now = 0;
  /** Objects made since the scene opened (`stats.created`, #501). */
  readonly #created = { meshes: 0, materials: 0, textures: 0, geometries: 0 };
  /** The context's counts and their reading when the scene opened (`stats.gl`, dev only). */
  readonly #gl: { readonly counts: GlCounts; readonly atOpen: GlCounts } | null;
  #warm = false;

  constructor(scene: Scene, tile: ExploreTileResponse, options: ExploreSceneOptions) {
    this.#scene = scene;
    // Counted for the frame-rate guard (#501); they go with the scene.
    scene.onNewMeshAddedObservable.add(() => this.#created.meshes++);
    scene.onNewMaterialAddedObservable.add(() => this.#created.materials++);
    scene.onNewTextureAddedObservable.add(() => this.#created.textures++);
    scene.onNewGeometryAddedObservable.add(() => this.#created.geometries++);
    // Duck-typed (WebGL has a context, WebGPU none): a value import of `Engine`
    // would pull the WebGL engine into the first load (`renderer.ts` loads it on demand).
    const gl = (scene.getEngine() as { _gl?: CountedGl | null })._gl;
    const counts = import.meta.env.DEV && gl ? countGl(gl) : null;
    this.#gl = counts ? { counts, atOpen: { ...counts } } : null;
    this.#tile = tile;
    this.#underwater = isUnderwater(tile.terrain);
    this.#highTier = bubblesAt(options.tier);
    // Underwater the Keeper swims instead of hopping (#399).
    this.#reduced = options.reducedMotion ?? (() => false);
    this.#redraw = options.redraw ?? (() => {});
    this.#pinned = options.pinned ?? false;
    // The sky by the patch's time of day (#335); it sets the clear colour too.
    this.#sky = new ExploreSky(scene, options.sky);
    this.#instrumentation = new SceneInstrumentation(scene);
    // The tile's own buildings (a fire out on the land, #202), on their spots.
    const buildingsAt = (options.mapTile?.buildings ?? []).map((b) => ({
      b,
      at: spotWorld({ q: 0, r: 0 }, b.spot, this.#size),
    }));
    this.#colliders = collidersOf(
      tile.spots,
      buildingsAt.map(({ at }) => ({ x: at.x / this.#size, z: at.z / this.#size })),
    );
    // The start clear of the spots, as the screen moves it, so the camera
    // opens on it instead of easing across.
    this.#at = freePoint(EXPLORE_VIEW.start, this.#colliders);

    const landLook =
      LAND_LOOKS[tile.terrain] ?? LAKE_LOOKS[tile.terrain] ?? BIOME_LOOKS[tile.terrain];
    const waterLook = WATER_LOOKS_BY_TERRAIN[tile.terrain];
    // A biome's own layers: the lake's kelp and coral, the trail's peaks, the cave's walls.
    const extras = waterLook
      ? lakeExtras(waterLook, tileSeed(tile, 'water'))
      : BIOME_EXTRAS[tile.terrain];
    if (landLook) {
      // The land kit (#335 art reset): sculpted ground, layered growth, soft light and haze.
      const size = this.#size;
      this.#land = new ExploreLand(scene, {
        look: landLook,
        seed: tileSeed(tile, 'land'),
        size,
        colliders: this.#colliders.map((c) => ({ x: c.x * size, z: c.z * size, r: c.r * size })),
        start: this.#world(this.#at),
        tier: options.tier,
        sky: options.sky,
        lightBase: this.#sky.lightBase,
        ...(extras ? { extras } : {}),
      });
      const land = this.#land;
      this.#surface = (p) => land.heightAt(p.x * size, p.z * size);
      if (waterLook) {
        this.#water = new ExploreWater(scene, land, {
          look: waterLook,
          seed: tileSeed(tile, 'water'),
          size,
          start: this.#world(this.#at),
          springs: tile.spots.filter((s) => s.kind === 'pond').map((s) => this.#world(s)),
          tier: options.tier,
          sky: options.sky,
        });
      }
    } else {
      const look = TERRAIN_LOOKS[tile.terrain] ?? FALLBACK_LOOK;
      const h = look.height;
      // The same profile #buildGround lofts, so feet, props and decor sit on it.
      const top = tileSurface({
        radius: TILE_FILL,
        corner: CORNER,
        segments: SEGMENTS,
        centre: h + DOME,
        rings: TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })),
      });
      this.#surface = (p) => top(p) * this.#k;
      this.#buildGround(tile.terrain);
    }

    // The land's props are matte (art bible §4); today's tiles keep their vinyl.
    const propMaterial = vinyl(scene, 'explore-prop-mat', { color: '#ffffff' });
    if (this.#land) {
      propMaterial.roughness = 0.8;
      propMaterial.clearCoat.isEnabled = false;
    }
    // A see-through copy for props between the camera and the Keeper (#291).
    const fadedMaterial = vinyl(scene, 'explore-prop-faded-mat', { color: '#ffffff' });
    fadedMaterial.alpha = EXPLORE_FADE.alpha;
    if (this.#land) {
      // Matte like the solid copy, so a spot doesn't gain gloss as it fades.
      fadedMaterial.roughness = propMaterial.roughness;
      fadedMaterial.clearCoat.isEnabled = false;
    }
    fadedMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.#buildProps(tile, propMaterial, fadedMaterial);

    this.#buildings = new BuildingField(scene);
    this.#buildings.set(
      buildingsAt.map(({ b, at }) => ({
        buildingId: b.buildingId,
        level: b.level,
        lit: b.lit,
        x: at.x,
        z: at.z,
        y: this.#groundAt({ x: at.x / this.#size, z: at.z / this.#size }),
        scale: EXPLORE_VIEW.buildingScale,
      })),
    );

    this.#decor = { tufts: 0, pebbles: 0, flowers: 0 };
    if (this.#land) {
      // The land's own growth stands in for the decor (one draw call a kind, as before).
      const { tufts, pebbles, flowers } = this.#land.layout;
      this.#decor = {
        tufts: tufts.length,
        pebbles: pebbles.length,
        flowers: flowers.daisy.length + flowers.tulip.length + flowers.bell.length,
      };
    } else {
      // Grass tufts, pebbles and flowers (#291): thin instances, one draw call a kind.
      // Their own material, so night tints them with the ground, never the spots.
      const decorMaterial = vinyl(scene, 'explore-decor-mat', { color: '#ffffff' });
      this.#ground.push({ mat: decorMaterial, base: decorMaterial.albedoColor.clone() });
      const places = decorPlaces(tile, this.#colliders);
      for (const kind of ['tufts', 'pebbles', 'flowers'] as const) {
        const mesh = buildDecor(scene, kind);
        mesh.material = decorMaterial;
        setInstances(
          mesh,
          places[kind].map((p) => {
            const at = this.#world(p);
            const s = p.scale;
            return placeAt(
              at.x,
              this.#groundAt(p),
              at.z,
              new Vector3(s, s, s),
              Quaternion.RotationYawPitchRoll(p.yaw, 0, 0),
            );
          }),
        );
        this.#decor[kind] = places[kind].length;
      }
    }

    // Unsearched spots glint (#291): a little star over each, turned to the camera.
    this.#glints = buildGlint(scene);
    this.#glints.material = overlayMaterial(scene, 'explore-glint-mat');
    // The soft halo under the spot in front of the Keeper.
    this.#halo = kitMesh(scene, 'explore-halo', () => {
      const halo = disc({ radius: 1, tessellation: 32 });
      halo.rotation.x = Math.PI / 2;
      return halo.bakeCurrentTransformIntoVertices();
    });
    this.#halo.alwaysSelectAsActiveMesh = false;
    const haloMat = overlayMaterial(scene, 'explore-halo-mat');
    haloMat.emissiveColor = linear('#fffbe0');
    haloMat.alpha = EXPLORE_VIEW.halo.alpha;
    this.#halo.material = haloMat;
    this.#halo.isPickable = false;
    this.#halo.setEnabled(false);

    // Underwater the swimmer's own soft shadow lies under its middle (#399),
    // in place of the field's, which sits at the feet.
    this.#keepers = new KeeperField(scene, {
      data: KEEPER_DATA,
      lod: options.lod,
      shadows: !this.#underwater,
    });
    if (options.keeper) {
      this.#keeper = this.#keepers.add(
        options.keeper,
        this.#keeperPlacement(),
        keeperItems(options.keeperWearing ?? []),
      );
      if (this.#underwater) {
        // The Snorkel worn on the face (#335): a mask and its orange tube,
        // in head-width units.
        const part = (m: Part, x: number, y: number, z: number, hex: string) => {
          m.position.set(x, y, z);
          return painted(m, hex);
        };
        // Round and toy-like, like the rest of the kit: a blue frame, a pale lens, a bent tube.
        const blob = (
          d: number,
          at: [number, number, number],
          k: [number, number, number],
          hex: string,
        ) => {
          const m = uvSphere({ diameter: d, segments: 8 });
          m.scaling.set(...k);
          return part(m, at[0], at[1], at[2], hex);
        };
        const mask = kitMesh(scene, 'explore-mask', () =>
          merged([
            blob(0.9, [0, 0, 0], [1, 0.55, 0.3], '#3aa0d8'),
            blob(0.72, [0, 0, -0.06], [1, 0.48, 0.3], '#d9f7ff'),
            part(
              cylinderPart({ height: 0.7, diameter: 0.1, tessellation: 10 }),
              0.52,
              0.34,
              0.06,
              '#ff8a4a',
            ),
            blob(0.16, [0.52, 0.7, 0.06], [1, 1, 1], '#ff6a3a'),
          ]),
        );
        mask.material = propMaterial;
        mask.isPickable = false;
        this.#mask = mask;
        this.#bubbles = new SwimBubbles(scene, EXPLORE_VIEW.keeperScale);
        const shadow = createContactShadowMesh(scene);
        shadow.name = 'swim-shadow';
        shadow.thinInstanceSetBuffer('matrix', this.#swimShadowMatrix, 16, false);
        shadow.thinInstanceSetBuffer(
          'color',
          new Float32Array([1, 1, 1, EXPLORE_SWIM.shadow.alpha]),
          4,
          true,
        );
        this.#swimShadow = shadow;
      }
    }

    // The tools the Keeper can hold (#291): one small mesh each, one shown.
    this.#tools = {
      shovel: buildTool(scene, 'shovel'),
      net: buildTool(scene, 'net'),
      rope: buildTool(scene, 'rope'),
      lantern: buildTool(scene, 'lantern'),
    };
    for (const tool of TOOLS) {
      this.#tools[tool].material = propMaterial;
      this.#tools[tool].setEnabled(false);
    }

    // The follow camera (#291): the stage's camera gets no input (the HUD's
    // ground layer covers the canvas), so its shot is written just before
    // each render, as the battle does.
    this.#camera = { target: cameraGoal(this.#at), zoom: 1 };
    this.#beforeRender = scene.onBeforeRenderObservable.add(() => {
      this.#applyCamera();
    });
    this.#afterRender = scene.onAfterRenderObservable.add(() => {
      this.#drawCalls = this.#instrumentation.drawCallsCounter.current;
      this.#triangles = Math.round(scene.getActiveIndices() / 3);
      this.#refreshFraming();
    });
    scene.onDisposeObservable.addOnce(() => {
      scene.onBeforeRenderObservable.remove(this.#beforeRender);
      scene.onAfterRenderObservable.remove(this.#afterRender);
      this.#instrumentation.dispose();
    });

    this.#tintGround(options.sky);
    this.content = {
      bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      start: { x: 0, z: 0 },
      // Explore runs cool: 30 drawn frames a second, walking or idle (#501, owner Oct 18).
      frameCap: FRAME_CAP_30,
    };
    this.update(tile);
    void this.#prewarm(scene);
  }

  /**
   * Compiles every program a mesh shown later will need (#501 D1, the
   * glint-find stutter): the tools, the faded spots, the halo, the night's
   * motes. The stage settles once the scene is ready, and Babylon's check
   * skips disabled meshes, so each of these used to compile (50–300 ms on a
   * phone) the first time it showed, in the middle of a find. Held as the
   * scene's pending data, so the stage keeps loading until they're done.
   */
  async #prewarm(scene: Scene): Promise<void> {
    const pending = {};
    scene.addPendingData(pending);
    const later = scene.meshes.filter(
      (m) => m.material !== null && !m.isEnabled() && m.getTotalVertices() > 0,
    );
    // Each as it will be drawn, for the same program: the halo sits scaled
    // (r, 1, r) under a spot (non-uniform scaling is its own program), and a
    // faded copy draws thin-instanced, so it compiles with its solid's places
    // (with none it would take the uninstanced program), still hidden.
    this.#halo.scaling.set(2, 1, 2);
    this.#halo.computeWorldMatrix(true);
    for (const { faded, spots } of this.#props.values()) {
      if (faded.isEnabled()) continue;
      setInstances(
        faded,
        spots.map((s) => s.matrix),
        true,
      );
      faded.setEnabled(false);
    }
    // Drawn as Babylon draws them: a thin-instanced mesh takes the instanced
    // program (`Mesh.render` passes `hasThinInstances`). One at a time, so a
    // tap still gets through between compiles.
    const compiled = (async () => {
      for (const m of later) {
        try {
          await m.material?.forceCompilationAsync(m, { useInstances: m.hasThinInstances });
        } catch {
          // A program that won't compile shows as it did before: compiled on first draw.
        }
        if (scene.isDisposed) return;
      }
      // Back to no instances, unless the fade has taken a copy over meanwhile.
      // Only now: a compile still polling would take the uninstanced program.
      for (const { faded, spots } of this.#props.values()) {
        if (!spots.some((s) => this.#hiding.has(s.index))) setInstances(faded, []);
      }
      this.#warm = true;
    })();
    // A compile that never finishes holds the stage no longer than `EXPLORE_PREWARM.maxMs`.
    let cap: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        compiled,
        new Promise((done) => (cap = setTimeout(done, EXPLORE_PREWARM.maxMs))),
      ]);
    } finally {
      clearTimeout(cap);
      if (!scene.isDisposed) scene.removePendingData(pending);
    }
  }

  get stats(): ExploreSceneStats {
    return {
      spots: this.#tile.spots.length,
      done: this.#tile.spots.filter((s) => s.done).length,
      glints: this.#tile.spots.filter((s) => !s.done).length,
      buildings: this.#buildings.stats.buildings,
      keeper: this.#keeper !== null,
      propMeshes: this.#props.size,
      decor: { ...this.#decor },
      highlighted: this.#highlighted,
      held: this.#held,
      camera: { ...this.#camera.target, zoom: this.#camera.zoom },
      drawCalls: this.#drawCalls,
      faded: [...this.#hiding].sort((a, b) => a - b),
      fadedCover: this.#fadedCover(),
      keeperHeight: this.#keeperHeight(),
      sky: this.#sky.stats,
      triangles: this.#triangles,
      created: { ...this.#created },
      gl: this.#gl
        ? {
            buffers: this.#gl.counts.buffersMade - this.#gl.atOpen.buffersMade,
            programs: this.#gl.counts.programs - this.#gl.atOpen.programs,
          }
        : null,
      warm: this.#warm,
      land: this.#land?.stats ?? null,
      water: this.#water?.stats ?? null,
      ambient: this.ambientStatus,
      swim: this.#underwater
        ? {
            pitch: this.#swimPose.pitch,
            strokes: this.#swim.phase,
            moving: this.#swim.moving,
            bubbles: this.#bubbles?.alive ?? 0,
          }
        : null,
    };
  }

  /** The Keeper's feet to the top of its hair on screen, as a share of the canvas height. */
  #keeperHeight(): number {
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    const h = canvas?.getBoundingClientRect().height ?? 0;
    if (!this.#keeper || h <= 0) return 0;
    const feet = this.screenOf(this.#at, 0);
    const top = this.screenOf(this.#at, this.keeperTall);
    return feet && top ? Math.abs(feet.y - top.y) / h : 0;
  }

  /** Where the Keeper stands now, tile-local. */
  get keeperAt(): WorldPoint {
    return this.#at;
  }

  /** The Keeper's height, world units (feet to the top of its hair). */
  get keeperTall(): number {
    return this.#keeper ? this.#keeper.params.height * EXPLORE_VIEW.keeperScale : 0;
  }

  /** The spots' and buildings' colliders, tile-local. */
  get colliders(): readonly Collider[] {
    return this.#colliders;
  }

  /** Redraws which spots still glint from a fresh view of the tile. */
  update(tile: ExploreTileResponse): void {
    this.#tile = tile;
    this.#glintNudge = [];
    this.#placeGlints();
    if (this.#highlighted !== null && tile.spots.find((s) => s.index === this.#highlighted)?.done) {
      this.highlight(null);
    }
  }

  /** The soft halo under the spot in front (null: none). */
  highlight(index: number | null): void {
    this.#highlighted = index;
    const spot = index === null ? undefined : this.#tile.spots.find((s) => s.index === index);
    if (!spot) {
      this.#highlighted = null;
      this.#halo.setEnabled(false);
      return;
    }
    const at = this.#world(spot);
    const r = spotRadius(spot.kind) * this.#size * EXPLORE_VIEW.halo.size;
    this.#halo.position.set(at.x, this.#groundAt(spot) + 0.04, at.z);
    this.#halo.scaling.set(r, 1, r);
    this.#halo.setEnabled(true);
  }

  /** The tool in the Keeper's hand (null: hands). */
  hold(tool: ToolId | null): void {
    // Underwater the Snorkel is worn on the face, not carried (#335).
    if (this.#underwater && tool === 'net') tool = null;
    if (tool === this.#held) return;
    this.#held = tool;
    for (const t of TOOLS) this.#tools[t].setEnabled(t === tool);
    this.#placeTool();
  }

  /**
   * Moves the Keeper (tile-local). `yaw` faces the way it walks; left out,
   * it keeps its heading.
   */
  moveKeeper(at: WorldPoint, yaw?: number): void {
    // The ground covered drives the hop (#317); a jump to a new place doesn't.
    const step = Math.hypot(at.x - this.#at.x, at.z - this.#at.z);
    if (step <= TELEPORT) this.#walked += step;
    this.#at = at;
    if (yaw !== undefined) this.#yaw = yaw;
    this.#fade();
    this.#placeGlints();
    // While hopping, `step` places the Keeper this frame with the new pose.
    if (!this.#posing) this.#place();
  }

  /**
   * The camera leans in on a spot while a tool is in use (#291); null leans
   * back out. With the lantern lit it follows the Keeper and its light instead.
   */
  nudge(spot: WorldPoint | null, lit = false): void {
    this.#focus = lit ? null : spot;
    this.#lit = spot !== null && lit;
  }

  /** One swing of the tool (a scoop, a shake, a step up the trail) and a little jiggle. */
  useTool(now: number): void {
    this.#swingAt = now;
    if (this.#keeper) this.#keepers.play(this.#keeper, 'jiggle', now, EXPLORE_TOOL.jiggle);
  }

  /** A little hop for the Keeper when a search finds something. */
  cheer(now: number): void {
    if (this.#keeper) this.#keepers.play(this.#keeper, 'bounce', now);
  }

  /** Steps animations and the follow camera; true while anything still moves (keep drawing). */
  step(now: number): boolean {
    const dt =
      this.#lastStep === null
        ? 0
        : Math.min(EXPLORE_VIEW.maxFrameStep, (now - this.#lastStep) / 1000);
    this.#lastStep = now;
    const goal = this.#cameraGoal();
    this.#camera = followStep(this.#camera, goal, dt);
    const following = !cameraSettled(this.#camera, goal);
    let swinging = false;
    if (this.#swingAt !== null) {
      const t = (now - this.#swingAt) / EXPLORE_TOOL.swingMs;
      if (t >= 1 || t < 0) {
        this.#swingAt = null;
        this.#swing = 0;
      } else {
        this.#swing = Math.sin(t * Math.PI) * EXPLORE_TOOL.swingAngle;
        swinging = true;
      }
      this.#placeTool();
    }
    this.#now = now;
    const hopping = this.#underwater ? this.#stepSwims(dt) : this.#stepHops(dt);
    const keeper = this.#keepers.update(now);
    if (!following && !swinging && !hopping) this.#lastStep = null;
    return keeper || following || swinging || hopping;
  }

  /**
   * Hops along by the ground covered since the last step (#317) and places
   * the Keeper; true while it still hops, lands or settles. The stick's
   * push is the share of full walking speed this frame covered.
   */
  #stepHops(dt: number): boolean {
    const reduced = this.#reduced();
    // The first step after a rest has no time to measure a push against.
    const walked = dt > 0 ? this.#walked : 0;
    const push = dt > 0 ? walked / (EXPLORE_VIEW.walkSpeed * dt) : 0;
    this.#walked = 0;
    stepHop(this.#hop, walked, dt, push, reduced);
    const hopping = hopActive(this.#hop);
    // One more placement (and frame) after the last hop lands, at rest.
    const drawing = hopping || this.#posing;
    if (drawing) this.#place();
    this.#posing = hopping;
    return drawing;
  }

  /**
   * Swims along by the water covered since the last step (#399), like the
   * hop: a kick puffs bubbles from the mask. True while the Keeper still swims,
   * eases back to treading water, or a bubble rises.
   */
  #stepSwims(dt: number): boolean {
    const walked = dt > 0 ? this.#walked : 0;
    const push = dt > 0 ? walked / (EXPLORE_VIEW.walkSpeed * dt) : 0;
    this.#walked = 0;
    const kicked = stepSwim(this.#swim, walked, dt, push);
    const swimming = swimActive(this.#swim);
    // One more placement (and frame) after the swim settles, as the hop does.
    const drawing = swimming || this.#posing;
    if (drawing) this.#place();
    if (kicked && this.#highTier && !this.#reduced() && this.#mask) {
      this.#bubbles?.puff(this.#mask.position, this.#now);
    }
    const rising = this.#bubbles?.step(this.#now) ?? false;
    this.#posing = swimming;
    return drawing || rising;
  }

  /** Places the Keeper and its tool with this frame's hop pose. */
  #place(): void {
    if (this.#underwater) {
      this.#placeSwimmers();
      return;
    }
    const reduced = this.#reduced();
    hopPose(this.#hop, reduced, 1, this.#pose);
    if (this.#keeper) this.#keepers.move(this.#keeper, this.#keeperPlacement());
    this.#placeTool();
  }

  /** Places the Keeper, its mask and tool, swimming (#399). */
  #placeSwimmers(): void {
    const still = this.#reduced();
    const time = this.#land?.clock.time ?? 0;
    swimPose(this.#swim, still, time, this.#swimPose);
    if (this.#keeper) {
      this.#keepers.move(this.#keeper, this.#keeperPlacement());
      this.#placeSwimShadow();
    }
    this.#placeTool();
  }

  /**
   * The swimmer's soft shadow (#399): a round blob on the sand straight
   * under its middle (between the head on its point and the trailing feet),
   * lifted a little so a dune doesn't cut a hard edge into it.
   */
  #placeSwimShadow(): void {
    const shadow = this.#swimShadow;
    const keeper = this.#keeper;
    if (!shadow || !keeper) return;
    // Straight under its middle (`swimPlacement`, from this frame's pose).
    const at = swimPlacement(this.#swimPose, this.keeperTall, this.#yaw, SWIM_PLACE);
    SWIM_MIDDLE.x = this.#at.x + at.midX / this.#size;
    SWIM_MIDDLE.z = this.#at.z + at.midZ / this.#size;
    const d =
      keeper.params.width *
      EXPLORE_VIEW.keeperScale *
      CONTACT_SHADOW.scale *
      EXPLORE_SWIM.shadow.scale;
    Matrix.ComposeToRef(
      TOOL_SCALE.set(d, 1, d),
      SWIM_SHADOW_TURN,
      TOOL_AT.set(
        SWIM_MIDDLE.x * this.#size,
        this.#groundAt(SWIM_MIDDLE) + SWIM_SHADOW_LIFT,
        SWIM_MIDDLE.z * this.#size,
      ),
      TOOL_WORLD,
    );
    TOOL_WORLD.copyToArray(this.#swimShadowMatrix);
    shadow.thinInstanceBufferUpdated('matrix');
  }

  setLod(lod: SquishyLod): void {
    this.#keepers.setLod(lod);
  }

  /** The quality tier changed: the land's grass share follows (#335), and the swim's extras (#399). */
  setTier(tier: QualityTier): void {
    this.#land?.setTier(tier);
    this.#water?.setTier(tier);
    this.#highTier = bubblesAt(tier);
  }

  // ── Ambient life (#335): the map's driver paces it (`AmbientTarget`) ──────

  setAmbient(tier: QualityTier, reducedMotion: boolean): boolean {
    const mode = this.#land?.animated
      ? ambientMode({ tier, reducedMotion, slow: !this.#pinned && this.#judge.slow })
      : 'off';
    if (mode === this.#ambient) return false;
    this.#ambient = mode;
    this.#land?.setAmbient(mode);
    this.#water?.setAmbient(mode);
    return true;
  }

  get ambientMode(): AmbientMode {
    return this.#ambient;
  }

  /** Ambient life's mode and the judge's verdict (dev hook and the `?fps=1` badge). */
  get ambientStatus(): AmbientStatus {
    return { mode: this.#ambient, slow: this.#judge.slow, hitches: this.#hitches };
  }

  /**
   * A burst of work is about to land (a find, #501 H): the frames round it
   * aren't judged, so the lake's fish, bubbles and kelp don't stop for good.
   */
  expectHitch(): void {
    this.#hitches++;
    this.#judge.ignoreUntil(performance.now() + AMBIENT.hitchMs);
  }

  tick(now: number): boolean {
    const land = this.#land;
    if (this.#ambient !== 'live' || !land) return false;
    if (!this.#pinned && this.#judge.record(now)) {
      // Too slow for ambient life here: everything stands still from now on.
      this.#ambient = 'off';
      land.setAmbient('off');
      this.#water?.setAmbient('off');
      return true;
    }
    this.#ambientStart ??= now;
    land.clock.time = (now - this.#ambientStart) / 1000;
    if (this.#underwater) {
      // Treading water bobs on the same clock as the kelp.
      this.#placeSwimmers();
    }
    return true;
  }

  skipPace(): void {
    this.#judge.skip();
  }

  /** The ground under a point on the canvas (CSS pixels), tile-local, or null. */
  groundAt(x: number, y: number): WorldPoint | null {
    const camera = this.#scene.activeCamera;
    if (!camera) return null;
    this.#applyCamera();
    const ray = CreatePickingRay(this.#scene, x, y, null, camera);
    if (ray.direction.y >= 0) return null;
    // Onto the plane at the height under the last guess, a few times: the
    // ground only rolls gently under the camera, so it settles quickly.
    let p: WorldPoint = { x: 0, z: 0 };
    for (let i = 0; i < 6; i++) {
      const t = (this.#groundAt(p) - ray.origin.y) / ray.direction.y;
      p = {
        x: (ray.origin.x + ray.direction.x * t) / this.#size,
        z: (ray.origin.z + ray.direction.z * t) / this.#size,
      };
    }
    return p;
  }

  /**
   * Where a tile-local point (`lift` world units over the ground) is on
   * screen, CSS pixels from the page's top left, or null if the camera can't
   * see it. The lantern's light, the finds' flight and the dev hook use it.
   */
  screenOf(p: WorldPoint, lift = 0): { x: number; y: number } | null {
    const camera = this.#scene.activeCamera;
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    if (!camera || !canvas) return null;
    // The box is read once a frame (the lantern asks about a dozen points a frame).
    if (!this.#box) {
      this.#box = canvas.getBoundingClientRect();
      requestAnimationFrame(() => {
        this.#box = null;
      });
    }
    const box = this.#box;
    if (box.width <= 0 || box.height <= 0) {
      this.#box = null;
      return null;
    }
    this.#applyCamera();
    const at = this.#world(p);
    // (toGlobalToRef returns the camera's own viewport, not the one it fills.)
    camera.viewport.toGlobalToRef(box.width, box.height, SCREEN_VIEWPORT);
    const s = Vector3.ProjectToRef(
      SCREEN_FROM.set(at.x, this.#groundAt(p) + lift, at.z),
      Matrix.IdentityReadOnly,
      camera.getTransformationMatrix(),
      SCREEN_VIEWPORT,
      SCREEN_AT,
    );
    if (s.z < 0 || s.z > 1) return null;
    return { x: box.left + s.x, y: box.top + s.y };
  }

  #cameraGoal(): FollowCamera {
    let at = this.#at;
    if (this.#underwater && this.#swim.stretch > 0) {
      // A swimmer lies long across the screen (#399): lead it by its follow
      // lag (speed × the ease) and a little more, so it stays in the middle
      // instead of swimming off the edge of a phone held upright.
      const lead =
        EXPLORE_VIEW.walkSpeed *
        EXPLORE_CAMERA.follow *
        EXPLORE_SWIM.cameraLead *
        this.#swim.effort *
        this.#swim.stretch;
      SWIM_AIM.x = at.x - Math.sin(this.#yaw) * lead;
      SWIM_AIM.z = at.z - Math.cos(this.#yaw) * lead;
      at = SWIM_AIM;
    }
    return {
      target: cameraGoal(at, this.#focus, this.#lit),
      zoom: this.#focus ? EXPLORE_CAMERA.nudge : 1,
    };
  }

  /** Writes the follow camera's shot into the stage's camera. */
  #applyCamera(): void {
    const camera = this.#scene.activeCamera;
    if (!(camera instanceof TargetCamera)) return;
    const engine = this.#scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    if (aspect !== this.#aspect) {
      // The screen's shape picks the tilt (a phone upright looks flatter);
      // the fade and glints follow once the new shot is drawn (#refreshFraming).
      this.#aspect = aspect;
      this.#shot = cameraShot(aspect);
    }
    const { pitch, distance } = this.#shot;
    const d = distance * this.#camera.zoom;
    const tx = this.#camera.target.x * this.#size;
    const tz = this.#camera.target.z * this.#size;
    // Aim at the Keeper's own ground, not the ground ahead: on sculpted land a
    // dip ahead would bring the Keeper closer and draw it bigger (#335).
    const ty = this.#groundAt(this.#at) + AIM_HEIGHT;
    // Yaw 0: looking towards +z, down by `pitch`.
    writeShot(camera, this.#lookAt.set(tx, ty, tz), pitch, d);
    this.#sky.follow(camera.position, pitch);
  }

  /** A new sky (the screen checks the time once a minute, #335). */
  setSky(look: SkyLook): void {
    this.#sky.set(look);
    this.#tintGround(look);
    this.#land?.setSky(look);
    // After the land, whose haze the water's replaces.
    this.#water?.setSky(look);
  }

  /** The ground and decor take the time of day's tint; spots and glints don't. */
  #tintGround(look: SkyLook): void {
    const tint = Color3.FromHexString(look.groundTint);
    for (const g of this.#ground) g.mat.albedoColor = g.base.multiply(tint);
  }

  /** The held tool at the Keeper's hand, following its position and heading. */
  #placeTool(): void {
    this.#placeMask();
    const tool = this.#held ? this.#tools[this.#held] : null;
    if (!tool || !this.#keeper) return;
    const anchor = this.#keeper.params.sockets.held.anchors[0] ?? [0.2, 0.5, 0];
    const k = EXPLORE_VIEW.keeperScale;
    // The hand rides the hop (#317) and the swim (#399): placed, lifted,
    // turned and squashed with the Keeper.
    const place = this.#keeperPlacement();
    const squash = place.squash;
    Quaternion.RotationYawPitchRollToRef(place.yaw, place.lean, 0, TOOL_TURN);
    Matrix.ComposeToRef(
      TOOL_SCALE.set(k / Math.sqrt(squash), k * squash, k / Math.sqrt(squash)),
      TOOL_TURN,
      TOOL_AT.set(place.x, place.y + place.lift, place.z),
      TOOL_WORLD,
    );
    Vector3.TransformCoordinatesToRef(
      TOOL_ANCHOR.set(anchor[0], anchor[1], anchor[2]),
      TOOL_WORLD,
      tool.position,
    );
    const s = k * EXPLORE_TOOL.scale;
    tool.scaling.set(s, s, s);
    // A swing tips the tool forward, the way the Keeper faces (and swims).
    const pitch = this.#underwater ? place.lean : 0;
    tool.rotationQuaternion ??= new Quaternion();
    Quaternion.RotationYawPitchRollToRef(
      place.yaw,
      pitch - this.#swing,
      0,
      tool.rotationQuaternion,
    );
  }

  /** Fades the props that stand between the camera and the Keeper; the rest stay solid. */
  #fade(): void {
    if (this.#props.size === 0) return;
    // The camera first: its tilt follows the screen's shape, which the first
    // call learns (and that re-enters here); work from the settled shot.
    this.#applyCamera();
    const middle = AIM_HEIGHT / this.#size;
    // Into the spare set (no allocation while walking); swapped in only on a change.
    const hiding = hidingSpots(
      this.#at,
      this.#tile.spots,
      this.#shot.pitch,
      this.#heightOf,
      middle,
      this.#hidingNext,
    );
    // The line-of-sight rule is generous (a canopy's width); keep only the
    // spots that really cover the Keeper on screen, so nothing beside it fades.
    const keeper = this.#keeperBox();
    if (keeper) {
      for (const s of this.#tile.spots) {
        if (hiding.has(s.index) && this.#coverOf(s, keeper) < EXPLORE_FADE.cover)
          hiding.delete(s.index);
      }
    }
    let same = hiding.size === this.#hiding.size;
    for (const i of hiding) same &&= this.#hiding.has(i);
    if (same) return;
    this.#hidingNext = this.#hiding;
    this.#hiding = hiding;
    const solid = this.#solidScratch;
    const faded = this.#fadedScratch;
    for (const batch of this.#props.values()) {
      solid.length = 0;
      faded.length = 0;
      for (const s of batch.spots) (hiding.has(s.index) ? faded : solid).push(s.matrix);
      setInstances(batch.mesh, solid, true);
      // While `#prewarm` compiles, a copy keeps the instances it was lent (hidden),
      // so its program is still the instanced one.
      if (faded.length === 0 && !this.#warm) batch.faded.setEnabled(false);
      else setInstances(batch.faded, faded, true);
    }
  }

  /** The shot as it stands: where the Keeper is, where the camera aims, how close and how tilted. */
  #framingKey(): string {
    const { target, zoom } = this.#camera;
    return [this.#at.x, this.#at.z, target.x, target.z, zoom, this.#aspect].join(',');
  }

  /**
   * After a frame is drawn (#335): once the camera has settled on a new shot
   * (arriving, walking, turning the device, leaning in to a spot), work the
   * fade and the glints out against it, and draw again if either changed.
   * Until the Keeper can be placed on screen (the canvas not laid out yet),
   * ask for another frame and try again.
   */
  #refreshFraming(): void {
    if (!cameraSettled(this.#camera, this.#cameraGoal())) return;
    const key = this.#framingKey();
    if (key === this.#framed) return;
    if (this.#keeper && !this.#keeperBox()) {
      this.#redraw();
      return;
    }
    this.#framed = key;
    const hiding = this.#hiding;
    const glints = this.#glintNudge;
    this.#fade();
    this.#placeGlints();
    if (this.#hiding !== hiding || this.#glintNudge !== glints) this.#redraw();
  }

  /**
   * Draws a glint beside each unsearched spot, as on the boards; one that
   * would cover the Keeper on screen slides sideways, clear of it (#335).
   * Redrawn only when a glint moves.
   */
  #placeGlints(): void {
    this.#applyCamera(); // the shot's tilt, as #fade
    const size = EXPLORE_VIEW.glintSize;
    const keeper = { ...this.#world(this.#at), y: this.#groundAt(this.#at) };
    const half = (size * EXPLORE_FADE.glintHalo) / 2;
    const open = this.#tile.spots.filter((s) => !s.done);
    const places = open.map((s) => {
      const at = this.#world(s);
      // Off to one side of the prop, as on the boards.
      const side = spotRadius(s.kind) * this.#size * EXPLORE_VIEW.glintSide;
      const glint = { x: at.x + side, y: this.#groundAt(s) + this.#glintLift(s.kind), z: at.z };
      const slide = this.#keeper
        ? glintNudge(
            glint,
            keeper,
            this.keeperTall,
            this.#shot.pitch,
            half,
            EXPLORE_FADE.glintClearHalfWidth,
            this.#glintSide.get(s.index),
          )
        : 0;
      if (slide === 0) this.#glintSide.delete(s.index);
      else this.#glintSide.set(s.index, Math.sign(slide + glint.x - keeper.x));
      return { ...glint, x: glint.x + Math.round(slide * 100) / 100 };
    });
    const nudge = places.map((p) => p.x);
    const same =
      nudge.length === this.#glintNudge.length && nudge.every((n, i) => n === this.#glintNudge[i]);
    if (same && this.#glints.thinInstanceCount === open.length) return;
    this.#glintNudge = nudge;
    setInstances(
      this.#glints,
      places.map((p) => placeAt(p.x, p.y, p.z, new Vector3(size, size, size))),
      true,
    );
  }

  #fadedCover(): number[] {
    const keeper = this.#keeperBox();
    return [...this.#hiding]
      .sort((a, b) => a - b)
      .map((i) => {
        const spot = this.#tile.spots.find((s) => s.index === i);
        return spot && keeper ? Math.round(this.#coverOf(spot, keeper) * 1000) / 1000 : 1;
      });
  }

  /** The Keeper on screen: its feet to the top of its hair, about as wide as its head. */
  #keeperBox(): ScreenBox | null {
    if (!this.#keeper) return null;
    const feet = this.screenOf(this.#at, 0);
    const top = this.screenOf(this.#at, this.keeperTall);
    if (!feet || !top) return null;
    const half = (feet.y - top.y) * EXPLORE_FADE.keeperHalfWidth;
    // Before the canvas is laid out the projection isn't real yet: can't tell.
    if (![feet.x, feet.y, top.y, half].every(Number.isFinite) || half <= 0) return null;
    return { left: feet.x - half, right: feet.x + half, top: top.y, bottom: feet.y };
  }

  /** How much of the Keeper a spot's prop covers on screen (#335); 1 when it can't tell. */
  #coverOf(spot: Pick<PublicSearchSpot, 'kind' | 'x' | 'z'>, keeper: ScreenBox): number {
    const base = this.screenOf(spot, 0);
    const top = this.screenOf(spot, this.#heightOf(spot.kind) * this.#size);
    const edge = this.screenOf({ x: spot.x + spotRadius(spot.kind), z: spot.z }, 0);
    if (!base || !top || !edge) return 1; // can't tell: keep the line-of-sight rule's answer
    const half = Math.abs(edge.x - base.x);
    const prop = { left: base.x - half, right: base.x + half, top: top.y, bottom: base.y };
    return coverShare(prop, keeper);
  }

  /** The ground's height under a tile-local point, world units. */
  #groundAt(p: WorldPoint): number {
    return this.#surface(p);
  }

  /** How high a spot's glint floats over the ground, world units: the kit's own, else the map prop's. */
  #glintLift(kind: string): number {
    const kit = this.#kitGlint.get(kind);
    if (kit !== undefined) return kit;
    return (EXPLORE_VIEW.glintLift[kind] ?? 0.25) * this.#k * EXPLORE_VIEW.propScale;
  }

  #world(p: WorldPoint): WorldPoint {
    return { x: p.x * this.#size, z: p.z * this.#size };
  }

  /**
   * On the ground at its tile-local point; the hop (#317) only lifts and
   * squashes what's drawn. Into the shared scratch (read straight away).
   */
  #keeperPlacement() {
    const pose = this.#pose;
    PLACE.x = this.#at.x * this.#size;
    PLACE.z = this.#at.z * this.#size;
    PLACE.y = this.#groundAt(this.#at);
    PLACE.yaw = this.#yaw;
    PLACE.scale = EXPLORE_VIEW.keeperScale;
    PLACE.lean = KEEPER_LEAN;
    PLACE.lift = pose.lift * this.keeperTall;
    PLACE.squash = pose.squash;
    PLACE.shadow = shadowScale(pose.lift);
    PLACE.shadowAlpha = shadowAlpha(pose.lift);
    if (this.#underwater) {
      // Swimming (#399): afloat, pitched forward about its head into the
      // heading (a negative lean; a positive one leans back), surging ahead
      // of its point on a kick and gliding back.
      const sp = this.#swimPose;
      const at = swimPlacement(sp, this.keeperTall, this.#yaw, SWIM_PLACE);
      PLACE.x += at.dx;
      PLACE.z += at.dz;
      PLACE.lean = at.lean;
      PLACE.lift = at.lift;
      PLACE.squash = sp.squash;
    }
    return PLACE;
  }

  /** The Snorkel's mask sits on the Keeper's face while it swims (#335). */
  #placeMask(): void {
    const mask = this.#mask;
    if (!mask || !this.#keeper) return;
    // The face, from the Keeper's own proportions (a big chibi head).
    const { height, width } = this.#keeper.params;
    const place = this.#keeperPlacement();
    Quaternion.RotationYawPitchRollToRef(place.yaw, place.lean, 0, TOOL_TURN);
    const k = EXPLORE_VIEW.keeperScale;
    const squash = place.squash;
    Matrix.ComposeToRef(
      TOOL_SCALE.set(k / Math.sqrt(squash), k * squash, k / Math.sqrt(squash)),
      TOOL_TURN,
      TOOL_AT.set(place.x, place.y + place.lift, place.z),
      TOOL_WORLD,
    );
    // On the face: the front of the head (the Keeper faces -z at yaw 0).
    Vector3.TransformCoordinatesToRef(
      TOOL_ANCHOR.set(
        0,
        height * EXPLORE_UNDERWATER.mask.up,
        -width * EXPLORE_UNDERWATER.mask.forward,
      ),
      TOOL_WORLD,
      mask.position,
    );
    mask.rotationQuaternion ??= new Quaternion();
    mask.rotationQuaternion.copyFrom(TOOL_TURN);
    const s = k * width * EXPLORE_UNDERWATER.mask.size;
    mask.scaling.set(s, s, s);
  }

  #buildGround(terrain: string): void {
    const look = TERRAIN_LOOKS[terrain] ?? FALLBACK_LOOK;
    const k = this.#k;
    const s = new Vector3(k, k, k);
    const h = look.height;
    const tile = meshFrom(
      this.#scene,
      'explore-tile',
      loftRoundedHex(
        HEX_SIZE * TILE_FILL,
        [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
        { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
      ),
    );
    const tileMat = vinyl(this.#scene, 'explore-tile-mat', { ...look, clearCoat: false });
    tile.material = tileMat;
    this.#ground.push({ mat: tileMat, base: tileMat.albedoColor.clone() });
    tile.isPickable = false;
    setInstances(tile, [placeAt(0, 0, 0, s)]);

    const island = CreateCylinder(
      'explore-island',
      { diameter: this.#size * 2.3, height: ISLAND_DEPTH * k, tessellation: 64 },
      this.#scene,
    );
    island.position.y = (-ISLAND_DEPTH * k) / 2;
    island.material = vinyl(this.#scene, 'explore-island-mat', { color: ISLAND.color });
    island.isPickable = false;
  }

  #buildProps(
    tile: ExploreTileResponse,
    material: ReturnType<typeof vinyl>,
    fadedMaterial: ReturnType<typeof vinyl>,
  ): void {
    const byKind = new Map<string, { index: number; matrix: Matrix }[]>();
    const builders = new Map<string, () => Mesh>();
    const built = new Map<string, ReturnType<typeof kitSpot>>();
    const solids = new Map<string, Mesh>();
    const scale = this.#k * EXPLORE_VIEW.propScale;
    for (const spot of tile.spots) {
      const shape = SPOT_PROPS[spot.kind] ?? 'rock';
      // Old forests grow their own old trees.
      const prop = shape === 'tree' && tile.terrain === 'old-forest' ? 'old-tree' : shape;
      // On the land kit (#335), its own rocks, trees, logs and flower beds (and the lake's,
      // trail's and cave's spots), drawn at world size: built once a kind (the first is the
      // solid copy).
      let kit = built.get(spot.kind);
      if (kit === undefined && this.#land) {
        kit = kitSpot(this.#scene, spot.kind, tile.terrain);
        built.set(spot.kind, kit);
      }
      const kind = kit ? `kit:${spot.kind}` : prop;
      if (kit) {
        solids.set(kind, kit.mesh);
        this.#kitGlint.set(spot.kind, kit.glint);
        builders.set(
          kind,
          () => kitSpot(this.#scene, spot.kind, tile.terrain)?.mesh ?? mapProp(this.#scene, 'rock'),
        );
      } else {
        builders.set(kind, () =>
          isShape(prop) ? buildShape(this.#scene, prop) : mapProp(this.#scene, prop),
        );
      }
      const at = this.#world(spot);
      // Each spot turned its own way, the same for everyone.
      const turn = Quaternion.RotationYawPitchRoll(spinOf(tile, spot.index), 0, 0);
      const s = kit ? 1 : scale;
      const list = byKind.get(kind) ?? [];
      list.push({
        index: spot.index,
        matrix: placeAt(at.x, this.#groundAt(spot), at.z, new Vector3(s, s, s), turn),
      });
      byKind.set(kind, list);
      // How tall the prop stands, tile-local (its glint floats about at its top).
      this.#heights.set(spot.kind, this.#glintLift(spot.kind) / this.#size);
    }
    for (const [kind, spots] of byKind) {
      const build = builders.get(kind) ?? (() => mapProp(this.#scene, 'rock'));
      const mesh = solids.get(kind) ?? build();
      mesh.material = material;
      // Its own mesh (a clone would share the thin instances): one more draw
      // call only while something hides the Keeper.
      const faded = build();
      faded.name = `${mesh.name}-faded`;
      faded.material = fadedMaterial;
      setInstances(
        mesh,
        spots.map((s) => s.matrix),
        true,
      );
      setInstances(faded, []);
      this.#props.set(kind, { mesh, faded, spots });
    }
  }
}

/**
 * A map prop at spot size, drawn from the kit's page cache (#501 D1): the
 * map's own builder runs once a page and its shape is kept, not rebuilt.
 */
function mapProp(scene: Scene, kind: PropKind): Mesh {
  const mesh = kitMesh(scene, `map-prop-${kind}`, () => {
    const built = buildProp(scene, kind).mesh;
    const part = new Part(VertexData.ExtractFromMesh(built, true, true));
    built.dispose();
    return part;
  });
  mesh.name = kind;
  return mesh;
}

/** A spot's own turn, hashed from the tile and spot (stable, no RNG state). */
function spinOf(tile: { q: number; r: number }, index: number): number {
  let h = 2166136261;
  for (const c of `${hexKey(tile)}:${String(index)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/** Paints a part one colour with an alpha (for the glint's soft glow). */
function tinted(part: Part, hex: string, alpha: number): Part {
  const colors = painted(part, hex).data.colors;
  for (let i = 3; colors && i < colors.length; i += 4) colors[i] = alpha;
  return part;
}

/**
 * The glint (#291, boards a and IPad): a four-point star in a soft glow,
 * 1 across, stood up and tipped to face the follow camera (which never turns).
 */
function buildGlint(scene: Scene): Mesh {
  const mesh = kitMesh(scene, 'explore-glints', glint);
  mesh.hasVertexAlpha = true;
  return mesh;
}

function glint(): Part {
  const diamond = (sx: number, sy: number, z: number, hex: string, alpha: number) => {
    const m = disc({ radius: 0.5, tessellation: 4 });
    m.scaling.set(sx, sy, 1);
    m.position.z = z;
    return tinted(m, hex, alpha);
  };
  const glow = disc({ radius: 0.5, tessellation: 20 });
  const part = merged([
    tinted(glow, '#fffbe0', 0.45),
    diamond(0.34, 1, -0.01, '#ffe7a0', 1),
    diamond(1, 0.34, -0.01, '#ffe7a0', 1),
    diamond(0.2, 0.62, -0.02, '#fffdf0', 1),
    diamond(0.62, 0.2, -0.02, '#fffdf0', 1),
  ]);
  part.rotation.x = EXPLORE_CAMERA.glintTilt;
  return part.bakeCurrentTransformIntoVertices();
}

/** The decor kinds (#291), vinyl-toy style, about knee-high on the Keeper or less. TUNE */
function buildDecor(scene: Scene, kind: DecorKind): Mesh {
  return kitMesh(scene, `explore-${kind}`, () => decor(kind));
}

function decor(kind: DecorKind): Part {
  switch (kind) {
    case 'tufts': {
      const blade = (h: number, lean: number, turn: number, hex: string) => {
        const m = uvSphere({ diameter: 1, segments: 4 });
        m.scaling.set(0.06, h, 0.03);
        m.position.y = h / 2;
        m.bakeCurrentTransformIntoVertices();
        m.rotation.set(0, turn, lean);
        return painted(m, hex);
      };
      return merged([
        blade(0.22, 0, 0, '#8cc472'),
        blade(0.17, 0.5, 0.4, '#7ab562'),
        blade(0.17, -0.5, -0.4, '#7ab562'),
        blade(0.14, 0.35, 1.9, '#9bd07f'),
      ]);
    }
    case 'pebbles': {
      const pebble = (d: number, x: number, z: number, hex: string) => {
        const m = uvSphere({ diameter: d, segments: 5 });
        m.scaling.set(1.2, 0.55, 1);
        m.position.set(x, d * 0.2, z);
        return painted(m, hex);
      };
      return merged([
        pebble(0.12, 0, 0, '#cbbfae'),
        pebble(0.08, 0.1, 0.05, '#bdb1a2'),
        pebble(0.06, -0.06, 0.09, '#d8cec0'),
      ]);
    }
    case 'flowers': {
      const flower = (x: number, z: number, h: number, hex: string) => {
        const stem = cylinderPart({ height: h, diameter: 0.018, tessellation: 5 });
        stem.position.set(x, h / 2, z);
        const bloom = uvSphere({ diameter: 0.09, segments: 5 });
        bloom.scaling.y = 0.7;
        bloom.position.set(x, h, z);
        return [painted(stem, '#6aa84f'), painted(bloom, hex)];
      };
      return merged([
        ...flower(0, 0, 0.16, '#ff8fab'),
        ...flower(0.08, 0.05, 0.12, '#ffd166'),
        ...flower(-0.06, 0.07, 0.13, '#b8a6ff'),
      ]);
    }
  }
}

/**
 * The tools in hand (#291), at Keeper scale 1 (about 1.6 tall), held at the
 * hand: the grip is the origin, the tool hangs down and a little forward
 * (−z is the way the Keeper faces).
 */
function buildTool(scene: Scene, tool: ToolId): Mesh {
  return kitMesh(scene, TOOL_MESHES[tool], () => toolShape(tool));
}

/** Each tool's mesh name (the net and rope were renamed in place, #335). */
const TOOL_MESHES: Readonly<Record<ToolId, string>> = {
  shovel: 'explore-shovel',
  net: 'explore-snorkel',
  rope: 'explore-walking-stick',
  lantern: 'explore-lantern',
};

function toolShape(tool: ToolId): Part {
  const stick = (length: number, hex: string) => {
    const m = cylinderPart({ height: length, diameter: 0.045, tessellation: 8 });
    m.position.y = 0.12 - length / 2;
    return painted(m, hex);
  };
  const at = (m: Part, x: number, y: number, z: number, rx = 0) => {
    m.position.set(x, y, z);
    m.rotation.x = rx;
    return m;
  };
  let part: Part;
  switch (tool) {
    case 'shovel':
      part = merged([
        stick(0.7, '#a77a52'),
        painted(at(box({ width: 0.18, height: 0.22, depth: 0.03 }), 0, -0.66, 0), '#c9ced8'),
        painted(at(uvSphere({ diameter: 0.08 }), 0, 0.14, 0), '#a77a52'),
      ]);
      break;
    case 'net':
      // The Snorkel (#335, renamed in place): a mask and an orange tube.
      part = merged([
        painted(at(box({ width: 0.22, height: 0.12, depth: 0.06 }), 0, -0.1, 0), '#9fe3ff'),
        painted(
          at(torus({ diameter: 0.24, thickness: 0.03, tessellation: 18 }), 0, -0.1, 0, Math.PI / 2),
          '#3aa0d8',
        ),
        painted(
          at(cylinderPart({ height: 0.32, diameter: 0.04, tessellation: 8 }), 0.14, 0.02, 0),
          '#ff8a4a',
        ),
      ]);
      break;
    case 'rope':
      // The Walking Stick (#335, renamed in place): a long stick with a knob.
      part = merged([
        stick(0.9, '#9a6a3c'),
        painted(at(uvSphere({ diameter: 0.09 }), 0, 0.14, 0), '#c88a4f'),
      ]);
      break;
    case 'lantern':
      part = merged([
        painted(
          at(torus({ diameter: 0.1, thickness: 0.018, tessellation: 12 }), 0, 0, 0, Math.PI / 2),
          '#8b93a3',
        ),
        painted(
          at(cylinderPart({ height: 0.04, diameter: 0.16, tessellation: 12 }), 0, -0.07, 0),
          '#7a2d55',
        ),
        painted(at(uvSphere({ diameter: 0.15, segments: 8 }), 0, -0.16, 0), '#ffe3a3'),
        painted(
          at(cylinderPart({ height: 0.04, diameter: 0.16, tessellation: 12 }), 0, -0.25, 0),
          '#7a2d55',
        ),
      ]);
      break;
  }
  // Tipped forward a little, the way a tool is carried.
  part.rotation.x = -0.25;
  return part.bakeCurrentTransformIntoVertices();
}

/**
 * The explore-only spot shapes, in map-prop units (a rock is about 0.25
 * across) and vinyl-toy style: soft, rounded, a little chunky.
 */
function buildShape(scene: Scene, shape: ExploreShape): Mesh {
  return kitMesh(scene, `explore-${shape}`, () => shapePart(shape));
}

function shapePart(shape: ExploreShape): Part {
  const sphere = (d: number) => uvSphere({ diameter: d, segments: 10 });
  const cylinder = (h: number, top: number, bottom: number) =>
    cylinderPart({ height: h, diameterTop: top, diameterBottom: bottom, tessellation: 16 });
  const at = (m: Part, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Part => {
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return m;
  };
  switch (shape) {
    case 'mound':
      // Soft earth with a little sprout on top: "dig here".
      return merged([
        painted(at(sphere(0.3), 0, 0, 0, 1.1, 0.45, 1), '#b88a5e'),
        painted(at(sphere(0.12), 0.05, 0.06, -0.03, 1, 0.6, 1), '#a57850'),
        painted(at(cylinder(0.08, 0.01, 0.02), -0.03, 0.12, 0.02), '#7ac27a'),
      ]);
    case 'pond':
      return merged([
        painted(at(cylinder(0.02, 0.38, 0.38), 0, 0.005, 0), '#7cc6f0'),
        painted(at(cylinder(0.015, 0.44, 0.44), 0, 0, 0), '#cfe9c4'),
        painted(at(cylinder(0.01, 0.09, 0.09), 0.08, 0.02, -0.05), '#6fbf73'),
      ]);
    case 'ledge':
      // A chunky cliff step with a flat top to climb to.
      return merged([
        painted(at(box({ width: 0.32, height: 0.22, depth: 0.2 }), 0, 0.11, 0), '#c9b79a'),
        painted(at(box({ width: 0.22, height: 0.12, depth: 0.16 }), 0.04, 0.28, 0.02), '#d8c8ab'),
        painted(at(sphere(0.08), -0.1, 0.24, -0.05, 1, 0.6, 1), '#9fd6a0'),
      ]);
    case 'cave':
      // A rounded hill with a dark doorway facing the camera.
      return merged([
        painted(at(sphere(0.36), 0, 0.02, 0, 1, 0.75, 0.9), '#bfb3cf'),
        painted(at(sphere(0.16), 0, 0.03, -0.15, 1, 1.1, 0.5), '#3a2f4a'),
      ]);
  }
}
