import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Material } from '@babylonjs/core/Materials/material';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  KEEPER_DATA,
  type ExploreTileResponse,
  type KeeperConfig,
  type PublicTile,
  type Species,
  type ToolId,
  type VisualRegistry,
  type WorldPoint,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { spotWorld } from '../home/home-layout.js';
import {
  FALLBACK_LOOK,
  HEX_SIZE,
  ISLAND,
  TERRAIN_LOOKS,
  TILE_FILL,
  type PropKind,
} from '../map/map-config.js';
import { loftRoundedHex } from '../map/hex-mesh.js';
import { linear, merged, painted } from '../map/map-props.js';
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
import type { SquishyLod } from '../procedural/config.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import {
  EXPLORE_CAMERA,
  EXPLORE_FADE,
  EXPLORE_HOP,
  EXPLORE_TOOL,
  EXPLORE_VIEW,
} from './explore-config.js';
import {
  createHop,
  hopActive,
  hopPose,
  shadowScale,
  stepHop,
  TELEPORT,
  type Hop,
  type HopPose,
} from './keeper-hop.js';
import {
  cameraGoal,
  cameraSettled,
  cameraShot,
  collidersOf,
  decorPlaces,
  followStep,
  freePoint,
  hidingSpots,
  tileSurface,
  spotRadius,
  type Collider,
  type DecorKind,
  type FollowCamera,
} from './explore-world.js';

// The explore view (#199; cozy-sim feel #291, owner mockup 2026-10-08): one
// of my tiles up close, its search spots drawn from the terrain's prop kit
// (the rocks, trees and mounds *are* the spots, and glint until searched),
// grass, pebbles and flowers grown from the tile's seed, its buildings, my
// Keeper with the tool in hand, and my team trailing behind. A camera
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
  readonly followers: number;
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
  /** The Keeper's height on screen, as a share of the canvas's height (0: not on screen). */
  readonly keeperHeight: number;
}

export interface ExploreSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly keeper: KeeperConfig | null;
  readonly keeperWearing?: readonly string[];
  /** The squishies on my team that follow the Keeper, in team order. */
  readonly team: readonly { readonly id: string; readonly species: Species }[];
  /** The tile as the map knows it: its buildings. */
  readonly mapTile: PublicTile | null;
  /** Reduce Motion: the Keeper and the team bob instead of hopping (#317). Default off. */
  readonly reducedMotion?: () => boolean;
}

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
};

type ExploreShape = 'mound' | 'pond' | 'ledge' | 'cave';

/** The island under the tile: shallow, so the tile reads as a little diorama. */
const ISLAND_DEPTH = 0.12; // TUNE:
const SHAPES: ReadonlySet<string> = new Set<ExploreShape>(['mound', 'pond', 'ledge', 'cave']);
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

/** A squishy following the Keeper along its trail, one gap behind the one before. */
interface Follower {
  readonly handle: SquishyHandle;
  /** Tile-local, updated in place as it follows. */
  readonly at: { x: number; z: number };
  yaw: number;
  readonly hop: Hop;
  /** Ground covered since the last step, tile-local. */
  walked: number;
}

/**
 * How far behind the Keeper the `i`th follower walks, tile-local: half a gap
 * more than one per place, the spacing the trail's points gave on average
 * before the team glided along it (#317).
 */
function followBack(i: number): number {
  return (i + 1.5) * EXPLORE_VIEW.followGap;
}

// Scratch for the hop pose being placed (no allocations while walking).
const POSE: HopPose = { lift: 0, squash: 1 };

export class ExploreScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #size = EXPLORE_VIEW.hexSize;
  readonly #k = EXPLORE_VIEW.hexSize / HEX_SIZE;
  /** The tile's top under a tile-local point, world units up (#291: nothing floats at the rim). */
  readonly #surface: (p: WorldPoint) => number;
  readonly #props = new Map<string, PropBatch>();
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
  readonly #decor: Record<DecorKind, number>;
  readonly #glints: Mesh;
  readonly #halo: Mesh;
  readonly #tools: Record<ToolId, Mesh>;
  readonly #colliders: Collider[];
  readonly #buildings: BuildingField;
  readonly #keepers: KeeperField;
  readonly #squishies: SquishyField;
  readonly #instrumentation: SceneInstrumentation;
  readonly #beforeRender: Observer<Scene>;
  readonly #afterRender: Observer<Scene>;
  readonly #lookAt = new Vector3();
  #keeper: KeeperHandle | null = null;
  readonly #followers: Follower[] = [];
  /** Tile-local points the Keeper walked through, newest first (to start with, where the team waits). */
  #trail: WorldPoint[] = [];
  /** The Keeper's hop (#317), its pose this frame, and the ground covered since the last step. */
  readonly #hop = createHop();
  readonly #pose: HopPose = { lift: 0, squash: 1 };
  #walked = 0;
  /** Someone was hopping, landing or settling at the last step. */
  #hopping = false;
  readonly #reduced: () => boolean;
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
  #drawCalls = 0;

  constructor(scene: Scene, tile: ExploreTileResponse, options: ExploreSceneOptions) {
    this.#scene = scene;
    this.#tile = tile;
    this.#reduced = options.reducedMotion ?? (() => false);
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    this.#instrumentation = new SceneInstrumentation(scene);
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
    const propMaterial = vinyl(scene, 'explore-prop-mat', { color: '#ffffff' });
    // A see-through copy for props between the camera and the Keeper (#291).
    const fadedMaterial = vinyl(scene, 'explore-prop-faded-mat', { color: '#ffffff' });
    fadedMaterial.alpha = EXPLORE_FADE.alpha;
    fadedMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.#buildProps(tile, propMaterial, fadedMaterial);

    // The tile's own buildings (a fire out on the land, #202), on their spots.
    const buildingsAt = (options.mapTile?.buildings ?? []).map((b) => ({
      b,
      at: spotWorld({ q: 0, r: 0 }, b.spot, this.#size),
    }));
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
    this.#colliders = collidersOf(
      tile.spots,
      buildingsAt.map(({ at }) => ({ x: at.x / this.#size, z: at.z / this.#size })),
    );
    // The start clear of the spots, as the screen moves it, so the camera
    // opens on it instead of easing across.
    this.#at = freePoint(EXPLORE_VIEW.start, this.#colliders);

    // Grass tufts, pebbles and flowers (#291): thin instances, one draw call a kind.
    const places = decorPlaces(tile, this.#colliders);
    this.#decor = { tufts: 0, pebbles: 0, flowers: 0 };
    for (const kind of ['tufts', 'pebbles', 'flowers'] as const) {
      const mesh = buildDecor(scene, kind);
      mesh.material = propMaterial;
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

    // Unsearched spots glint (#291): a little star over each, turned to the camera.
    this.#glints = buildGlint(scene);
    this.#glints.material = overlayMaterial(scene, 'explore-glint-mat');
    // The soft halo under the spot in front of the Keeper.
    this.#halo = CreateDisc('explore-halo', { radius: 1, tessellation: 32 }, scene);
    this.#halo.rotation.x = Math.PI / 2;
    this.#halo.bakeCurrentTransformIntoVertices();
    const haloMat = overlayMaterial(scene, 'explore-halo-mat');
    haloMat.emissiveColor = linear('#fffbe0');
    haloMat.alpha = EXPLORE_VIEW.halo.alpha;
    this.#halo.material = haloMat;
    this.#halo.isPickable = false;
    this.#halo.setEnabled(false);

    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    this.#squishies = new SquishyField(scene, {
      registry: options.registry,
      lod: options.lod,
      breathing: false,
    });
    if (options.keeper) {
      this.#keeper = this.#keepers.add(
        options.keeper,
        this.#keeperPlacement(),
        keeperItems(options.keeperWearing ?? []),
      );
    }
    // The team waits in a little line behind the Keeper: the start of its
    // trail, so they follow on from it.
    const line = options.team.map((_, i) => this.#trailPoint(i + 1));
    this.#trail = [...line, this.#trailPoint(line.length + 1)];
    options.team.forEach((member, i) => {
      const at = { x: 0, z: 0 };
      this.#alongTrail(followBack(i), at);
      const handle = this.#squishies.add(member.species, member.id, this.#squishyPlacement(at, 0));
      const hop = createHop(EXPLORE_HOP.followerOffset[i % EXPLORE_HOP.followerOffset.length]);
      this.#followers.push({ handle, at, yaw: 0, hop, walked: 0 });
    });

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
    });
    scene.onDisposeObservable.addOnce(() => {
      scene.onBeforeRenderObservable.remove(this.#beforeRender);
      scene.onAfterRenderObservable.remove(this.#afterRender);
      this.#instrumentation.dispose();
    });

    this.content = { bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, start: { x: 0, z: 0 } };
    this.update(tile);
  }

  get stats(): ExploreSceneStats {
    return {
      spots: this.#tile.spots.length,
      done: this.#tile.spots.filter((s) => s.done).length,
      glints: this.#tile.spots.filter((s) => !s.done).length,
      buildings: this.#buildings.stats.buildings,
      keeper: this.#keeper !== null,
      followers: this.#followers.length,
      propMeshes: this.#props.size,
      decor: { ...this.#decor },
      highlighted: this.#highlighted,
      held: this.#held,
      camera: { ...this.#camera.target, zoom: this.#camera.zoom },
      drawCalls: this.#drawCalls,
      faded: [...this.#hiding].sort((a, b) => a - b),
      keeperHeight: this.#keeperHeight(),
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
    const scale = this.#k * EXPLORE_VIEW.propScale;
    const size = EXPLORE_VIEW.glintSize;
    setInstances(
      this.#glints,
      tile.spots
        .filter((s) => !s.done)
        .map((s) => {
          const at = this.#world(s);
          const lift = (EXPLORE_VIEW.glintLift[s.kind] ?? 0.25) * scale;
          // Off to one side of the prop, as on the boards.
          const side = spotRadius(s.kind) * this.#size * EXPLORE_VIEW.glintSide;
          return placeAt(
            at.x + side,
            this.#groundAt(s) + lift,
            at.z,
            new Vector3(size, size, size),
          );
        }),
      true,
    );
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
    this.#halo.position.set(at.x, this.#groundAt(spot) + 0.02, at.z);
    this.#halo.scaling.set(r, 1, r);
    this.#halo.setEnabled(true);
  }

  /** The tool in the Keeper's hand (null: hands). */
  hold(tool: ToolId | null): void {
    if (tool === this.#held) return;
    this.#held = tool;
    for (const t of TOOLS) this.#tools[t].setEnabled(t === tool);
    this.#placeTool();
  }

  /**
   * Moves the Keeper (tile-local) and the team along its trail. `yaw` faces
   * the way it walks; left out, it keeps its heading.
   */
  moveKeeper(at: WorldPoint, yaw?: number): void {
    // The ground covered drives the hop (#317); a jump to a new place doesn't.
    const step = Math.hypot(at.x - this.#at.x, at.z - this.#at.z);
    if (step <= TELEPORT) this.#walked += step;
    this.#at = at;
    if (yaw !== undefined) this.#yaw = yaw;
    this.#fade();
    const head = this.#trail[0];
    const gap = EXPLORE_VIEW.followGap;
    if (!head || (head.x - at.x) ** 2 + (head.z - at.z) ** 2 >= gap * gap) {
      this.#trail = [at, ...this.#trail].slice(0, this.#followers.length + 2);
    }
    // The team glides along the trail, each one gap behind the one before.
    for (let i = 0; i < this.#followers.length; i++) {
      const f = this.#followers[i];
      if (!f) continue;
      const x = f.at.x;
      const z = f.at.z;
      this.#alongTrail(followBack(i), f.at);
      const moved = Math.hypot(f.at.x - x, f.at.z - z);
      if (moved === 0) continue;
      if (moved <= TELEPORT) f.walked += moved;
      const ahead = i === 0 ? at : (this.#followers[i - 1]?.at ?? at);
      f.yaw = faceYaw(ahead.x - f.at.x, ahead.z - f.at.z);
    }
    // While hopping, `step` places everyone this frame with the new pose.
    if (!this.#hopping) this.#place();
  }

  /**
   * The camera leans in on a spot while a tool is in use (#291); null leans
   * back out. With the lantern lit it follows the Keeper and its light instead.
   */
  nudge(spot: WorldPoint | null, lit = false): void {
    this.#focus = lit ? null : spot;
    this.#lit = spot !== null && lit;
  }

  /** One swing of the tool (a scoop, a shake, a step up the rope) and a little jiggle. */
  useTool(now: number): void {
    this.#swingAt = now;
    if (this.#keeper) this.#keepers.play(this.#keeper, 'jiggle', now, EXPLORE_TOOL.jiggle);
  }

  /** A little hop for the Keeper and the team when a search finds something. */
  cheer(now: number): void {
    if (this.#keeper) this.#keepers.play(this.#keeper, 'bounce', now);
    for (const f of this.#followers) this.#squishies.play(f.handle, 'wobble', now);
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
    const hopping = this.#stepHops(dt);
    const keeper = this.#keepers.update(now);
    const squishies = this.#squishies.update(now);
    if (!following && !swinging && !hopping) this.#lastStep = null;
    return keeper || squishies || following || swinging || hopping;
  }

  /**
   * Hops along by the ground covered since the last step (#317) and places
   * everyone; true while anyone still hops, lands or settles. The stick's
   * push is the share of full walking speed this frame covered.
   */
  #stepHops(dt: number): boolean {
    const reduced = this.#reduced();
    // The first step after a rest has no time to measure a push against.
    const walked = dt > 0 ? this.#walked : 0;
    const push = dt > 0 ? walked / (EXPLORE_VIEW.walkSpeed * dt) : 0;
    this.#walked = 0;
    stepHop(this.#hop, walked, dt, push, reduced);
    let hopping = hopActive(this.#hop);
    for (const f of this.#followers) {
      stepHop(f.hop, dt > 0 ? f.walked : 0, dt, push, reduced);
      f.walked = 0;
      hopping ||= hopActive(f.hop);
    }
    // One more placement after the last hop lands, at rest.
    if (hopping || this.#hopping) this.#place();
    this.#hopping = hopping;
    return hopping;
  }

  /** Places the Keeper, its tool and the team with this frame's hop pose. */
  #place(): void {
    const reduced = this.#reduced();
    hopPose(this.#hop, reduced, 1, this.#pose);
    if (this.#keeper) this.#keepers.move(this.#keeper, this.#keeperPlacement());
    this.#placeTool();
    for (const f of this.#followers) {
      hopPose(f.hop, reduced, EXPLORE_HOP.followerLift, POSE);
      this.#squishies.move(f.handle, this.#squishyPlacement(f.at, f.yaw, f.handle, POSE));
    }
  }

  /** The point `back` tile-local units behind the Keeper along its trail, into `out`. */
  #alongTrail(back: number, out: { x: number; z: number }): void {
    let x = this.#at.x;
    let z = this.#at.z;
    let left = back;
    for (let i = 0; i < this.#trail.length; i++) {
      const p = this.#trail[i];
      if (!p) break;
      const length = Math.hypot(p.x - x, p.z - z);
      if (length >= left && length > 0) {
        const u = left / length;
        out.x = x + (p.x - x) * u;
        out.z = z + (p.z - z) * u;
        return;
      }
      left -= length;
      x = p.x;
      z = p.z;
    }
    out.x = x;
    out.z = z;
  }

  setLod(lod: SquishyLod): void {
    this.#keepers.setLod(lod);
    this.#squishies.setLod(lod);
  }

  /** The ground under a point on the canvas (CSS pixels), tile-local, or null. */
  groundAt(x: number, y: number): WorldPoint | null {
    const camera = this.#scene.activeCamera;
    if (!camera) return null;
    this.#applyCamera();
    const ray = CreatePickingRay(this.#scene, x, y, null, camera);
    if (ray.direction.y >= 0) return null;
    // Onto the plane at the height under the last guess, a few times: the
    // top is nearly flat, so it settles at once.
    let p: WorldPoint = { x: 0, z: 0 };
    for (let i = 0; i < 3; i++) {
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
    return {
      target: cameraGoal(this.#at, this.#focus, this.#lit),
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
      // The screen's shape picks the tilt (a phone upright looks flatter).
      this.#aspect = aspect;
      this.#shot = cameraShot(aspect);
      this.#fade();
    }
    const { pitch, distance } = this.#shot;
    const d = distance * this.#camera.zoom;
    const tx = this.#camera.target.x * this.#size;
    const tz = this.#camera.target.z * this.#size;
    const ty = this.#groundAt(this.#camera.target) + AIM_HEIGHT;
    // Yaw 0: looking towards +z, down by `pitch`.
    camera.position.set(tx, ty + Math.sin(pitch) * d, tz - Math.cos(pitch) * d);
    camera.setTarget(this.#lookAt.set(tx, ty, tz));
  }

  /** The held tool at the Keeper's hand, following its position and heading. */
  #placeTool(): void {
    const tool = this.#held ? this.#tools[this.#held] : null;
    if (!tool || !this.#keeper) return;
    const anchor = this.#keeper.params.sockets.held.anchors[0] ?? [0.2, 0.5, 0];
    const at = this.#world(this.#at);
    const k = EXPLORE_VIEW.keeperScale;
    Quaternion.RotationYawPitchRollToRef(this.#yaw, KEEPER_LEAN, 0, TOOL_TURN);
    Matrix.ComposeToRef(
      // The hand rides the hop (#317): lifted and squashed with the Keeper.
      TOOL_SCALE.set(
        k / Math.sqrt(this.#pose.squash),
        k * this.#pose.squash,
        k / Math.sqrt(this.#pose.squash),
      ),
      TOOL_TURN,
      TOOL_AT.set(at.x, this.#groundAt(this.#at) + this.#pose.lift * this.keeperTall, at.z),
      TOOL_WORLD,
    );
    Vector3.TransformCoordinatesToRef(
      TOOL_ANCHOR.set(anchor[0], anchor[1], anchor[2]),
      TOOL_WORLD,
      tool.position,
    );
    const s = k * EXPLORE_TOOL.scale;
    tool.scaling.set(s, s, s);
    // A swing tips the tool forward, the way the Keeper faces.
    tool.rotationQuaternion ??= new Quaternion();
    Quaternion.RotationYawPitchRollToRef(this.#yaw, -this.#swing, 0, tool.rotationQuaternion);
  }

  /** Fades the props that stand between the camera and the Keeper; the rest stay solid. */
  #fade(): void {
    if (this.#props.size === 0) return;
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
      setInstances(batch.faded, faded, true);
    }
  }

  /** The ground's height under a tile-local point, world units. */
  #groundAt(p: WorldPoint): number {
    return this.#surface(p);
  }

  #world(p: WorldPoint): WorldPoint {
    return { x: p.x * this.#size, z: p.z * this.#size };
  }

  #trailPoint(n: number): WorldPoint {
    const point = this.#trail[n];
    if (point) return point;
    // Before the Keeper has walked: the team waits in a little line behind it.
    const behind = n * EXPLORE_VIEW.followGap;
    return { x: this.#at.x + (n % 2 === 0 ? 0.02 : -0.02), z: this.#at.z - behind };
  }

  /** On the ground at its tile-local point; the hop (#317) only lifts and squashes what's drawn. */
  #keeperPlacement() {
    const at = this.#world(this.#at);
    const pose = this.#pose;
    return {
      x: at.x,
      z: at.z,
      y: this.#groundAt(this.#at),
      yaw: this.#yaw,
      scale: EXPLORE_VIEW.keeperScale,
      lean: KEEPER_LEAN,
      lift: pose.lift * this.keeperTall,
      squash: pose.squash,
      shadow: shadowScale(pose.lift),
    };
  }

  #squishyPlacement(p: WorldPoint, yaw: number, handle?: SquishyHandle, pose?: HopPose) {
    const at = this.#world(p);
    const scale = EXPLORE_VIEW.squishyScale;
    return {
      x: at.x,
      z: at.z,
      y: this.#groundAt(p),
      yaw,
      scale,
      lift: handle && pose ? pose.lift * handle.params.height * scale : 0,
      squash: pose?.squash ?? 1,
      shadow: pose ? shadowScale(pose.lift) : 1,
    };
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
    tile.material = vinyl(this.#scene, 'explore-tile-mat', { ...look, clearCoat: false });
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
    const byKind = new Map<PropKind | ExploreShape, { index: number; matrix: Matrix }[]>();
    const scale = this.#k * EXPLORE_VIEW.propScale;
    for (const spot of tile.spots) {
      const shape = SPOT_PROPS[spot.kind] ?? 'rock';
      // Old forests grow their own old trees.
      const kind = shape === 'tree' && tile.terrain === 'old-forest' ? 'old-tree' : shape;
      const at = this.#world(spot);
      // Each spot turned its own way, the same for everyone.
      const turn = Quaternion.RotationYawPitchRoll(spinOf(tile, spot.index), 0, 0);
      const list = byKind.get(kind) ?? [];
      list.push({
        index: spot.index,
        matrix: placeAt(at.x, this.#groundAt(spot), at.z, new Vector3(scale, scale, scale), turn),
      });
      byKind.set(kind, list);
      // How tall the prop stands, tile-local (its glint floats about at its top).
      this.#heights.set(
        spot.kind,
        ((EXPLORE_VIEW.glintLift[spot.kind] ?? 0.25) * scale) / this.#size,
      );
    }
    for (const [kind, spots] of byKind) {
      const build = () =>
        isShape(kind) ? buildShape(this.#scene, kind) : buildProp(this.#scene, kind).mesh;
      const mesh = build();
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

/** A spot's own turn, hashed from the tile and spot (stable, no RNG state). */
function spinOf(tile: { q: number; r: number }, index: number): number {
  let h = 2166136261;
  for (const c of `${hexKey(tile)}:${String(index)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/** Paints a mesh one colour with an alpha (for the glint's soft glow). */
function tinted(mesh: Mesh, hex: string, alpha: number): Mesh {
  painted(mesh, hex);
  const colors = mesh.getVerticesData(VertexBuffer.ColorKind);
  if (colors) {
    for (let i = 3; i < colors.length; i += 4) colors[i] = alpha;
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  }
  return mesh;
}

/**
 * The glint (#291, boards a and IPad): a four-point star in a soft glow,
 * 1 across, stood up and tipped to face the follow camera (which never turns).
 */
function buildGlint(scene: Scene): Mesh {
  const diamond = (sx: number, sy: number, z: number, hex: string, alpha: number) => {
    const m = CreateDisc('explore-glint-part', { radius: 0.5, tessellation: 4 }, scene);
    m.scaling.set(sx, sy, 1);
    m.position.z = z;
    return tinted(m, hex, alpha);
  };
  const glow = CreateDisc('explore-glint-part', { radius: 0.5, tessellation: 20 }, scene);
  const mesh = merged('explore-glints', [
    tinted(glow, '#fffbe0', 0.45),
    diamond(0.34, 1, -0.01, '#ffe7a0', 1),
    diamond(1, 0.34, -0.01, '#ffe7a0', 1),
    diamond(0.2, 0.62, -0.02, '#fffdf0', 1),
    diamond(0.62, 0.2, -0.02, '#fffdf0', 1),
  ]);
  mesh.rotation.x = EXPLORE_CAMERA.glintTilt;
  mesh.bakeCurrentTransformIntoVertices();
  mesh.hasVertexAlpha = true;
  return mesh;
}

/** The decor kinds (#291), vinyl-toy style, about knee-high on the Keeper or less. TUNE */
function buildDecor(scene: Scene, kind: DecorKind): Mesh {
  switch (kind) {
    case 'tufts': {
      const blade = (h: number, lean: number, turn: number, hex: string) => {
        const m = CreateSphere('explore-tuft-blade', { diameter: 1, segments: 4 }, scene);
        m.scaling.set(0.06, h, 0.03);
        m.position.y = h / 2;
        m.bakeCurrentTransformIntoVertices();
        m.rotation.set(0, turn, lean);
        return painted(m, hex);
      };
      return merged('explore-tufts', [
        blade(0.22, 0, 0, '#8cc472'),
        blade(0.17, 0.5, 0.4, '#7ab562'),
        blade(0.17, -0.5, -0.4, '#7ab562'),
        blade(0.14, 0.35, 1.9, '#9bd07f'),
      ]);
    }
    case 'pebbles': {
      const pebble = (d: number, x: number, z: number, hex: string) => {
        const m = CreateSphere('explore-pebble', { diameter: d, segments: 5 }, scene);
        m.scaling.set(1.2, 0.55, 1);
        m.position.set(x, d * 0.2, z);
        return painted(m, hex);
      };
      return merged('explore-pebbles', [
        pebble(0.12, 0, 0, '#cbbfae'),
        pebble(0.08, 0.1, 0.05, '#bdb1a2'),
        pebble(0.06, -0.06, 0.09, '#d8cec0'),
      ]);
    }
    case 'flowers': {
      const flower = (x: number, z: number, h: number, hex: string) => {
        const stem = CreateCylinder(
          'explore-flower-stem',
          { height: h, diameter: 0.018, tessellation: 5 },
          scene,
        );
        stem.position.set(x, h / 2, z);
        const bloom = CreateSphere('explore-flower-bloom', { diameter: 0.09, segments: 5 }, scene);
        bloom.scaling.y = 0.7;
        bloom.position.set(x, h, z);
        return [painted(stem, '#6aa84f'), painted(bloom, hex)];
      };
      return merged('explore-flowers', [
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
  const stick = (length: number, hex: string) => {
    const m = CreateCylinder(
      `explore-${tool}-part`,
      { height: length, diameter: 0.045, tessellation: 8 },
      scene,
    );
    m.position.y = 0.12 - length / 2;
    return painted(m, hex);
  };
  const at = (m: Mesh, x: number, y: number, z: number, rx = 0) => {
    m.position.set(x, y, z);
    m.rotation.x = rx;
    return m;
  };
  let mesh: Mesh;
  switch (tool) {
    case 'shovel':
      mesh = merged('explore-shovel', [
        stick(0.7, '#a77a52'),
        painted(
          at(
            CreateBox(`explore-${tool}-part`, { width: 0.18, height: 0.22, depth: 0.03 }, scene),
            0,
            -0.66,
            0,
          ),
          '#c9ced8',
        ),
        painted(
          at(CreateSphere(`explore-${tool}-part`, { diameter: 0.08 }, scene), 0, 0.14, 0),
          '#a77a52',
        ),
      ]);
      break;
    case 'net':
      mesh = merged('explore-net', [
        stick(0.6, '#a77a52'),
        painted(
          at(
            CreateTorus(
              `explore-${tool}-part`,
              { diameter: 0.28, thickness: 0.03, tessellation: 18 },
              scene,
            ),
            0,
            -0.6,
            0,
            Math.PI / 2,
          ),
          '#ff8fab',
        ),
        painted(
          at(
            CreateSphere(`explore-${tool}-part`, { diameter: 0.26, segments: 6 }, scene),
            0,
            -0.6,
            0.06,
          ),
          '#f4ecf6',
        ),
      ]);
      // The bag of the net is soft and shallow.
      break;
    case 'rope':
      mesh = merged('explore-rope', [
        painted(
          at(
            CreateTorus(
              `explore-${tool}-part`,
              { diameter: 0.26, thickness: 0.06, tessellation: 16 },
              scene,
            ),
            0,
            -0.14,
            0,
            Math.PI / 2,
          ),
          '#d8b27a',
        ),
        painted(
          at(
            CreateTorus(
              `explore-${tool}-part`,
              { diameter: 0.2, thickness: 0.05, tessellation: 16 },
              scene,
            ),
            0,
            -0.14,
            0.04,
            Math.PI / 2,
          ),
          '#c99a62',
        ),
      ]);
      break;
    case 'lantern':
      mesh = merged('explore-lantern', [
        painted(
          at(
            CreateTorus(
              `explore-${tool}-part`,
              { diameter: 0.1, thickness: 0.018, tessellation: 12 },
              scene,
            ),
            0,
            0,
            0,
            Math.PI / 2,
          ),
          '#8b93a3',
        ),
        painted(
          at(
            CreateCylinder(
              `explore-${tool}-part`,
              { height: 0.04, diameter: 0.16, tessellation: 12 },
              scene,
            ),
            0,
            -0.07,
            0,
          ),
          '#7a2d55',
        ),
        painted(
          at(
            CreateSphere(`explore-${tool}-part`, { diameter: 0.15, segments: 8 }, scene),
            0,
            -0.16,
            0,
          ),
          '#ffe3a3',
        ),
        painted(
          at(
            CreateCylinder(
              `explore-${tool}-part`,
              { height: 0.04, diameter: 0.16, tessellation: 12 },
              scene,
            ),
            0,
            -0.25,
            0,
          ),
          '#7a2d55',
        ),
      ]);
      break;
  }
  // Tipped forward a little, the way a tool is carried.
  mesh.rotation.x = -0.25;
  mesh.bakeCurrentTransformIntoVertices();
  return mesh;
}

/**
 * The explore-only spot shapes, in map-prop units (a rock is about 0.25
 * across) and vinyl-toy style: soft, rounded, a little chunky.
 */
function buildShape(scene: Scene, shape: ExploreShape): Mesh {
  const sphere = (d: number) => CreateSphere(`${shape}-part`, { diameter: d, segments: 10 }, scene);
  const cylinder = (h: number, top: number, bottom: number) =>
    CreateCylinder(
      `${shape}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation: 16 },
      scene,
    );
  const at = (m: Mesh, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh => {
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return m;
  };
  switch (shape) {
    case 'mound':
      // Soft earth with a little sprout on top: "dig here".
      return merged(`explore-${shape}`, [
        painted(at(sphere(0.3), 0, 0, 0, 1.1, 0.45, 1), '#b88a5e'),
        painted(at(sphere(0.12), 0.05, 0.06, -0.03, 1, 0.6, 1), '#a57850'),
        painted(at(cylinder(0.08, 0.01, 0.02), -0.03, 0.12, 0.02), '#7ac27a'),
      ]);
    case 'pond':
      return merged(`explore-${shape}`, [
        painted(at(cylinder(0.02, 0.38, 0.38), 0, 0.005, 0), '#7cc6f0'),
        painted(at(cylinder(0.015, 0.44, 0.44), 0, 0, 0), '#cfe9c4'),
        painted(at(cylinder(0.01, 0.09, 0.09), 0.08, 0.02, -0.05), '#6fbf73'),
      ]);
    case 'ledge':
      // A chunky cliff step with a flat top to climb to.
      return merged(`explore-${shape}`, [
        painted(
          at(
            CreateBox(`${shape}-part`, { width: 0.32, height: 0.22, depth: 0.2 }, scene),
            0,
            0.11,
            0,
          ),
          '#c9b79a',
        ),
        painted(
          at(
            CreateBox(`${shape}-part`, { width: 0.22, height: 0.12, depth: 0.16 }, scene),
            0.04,
            0.28,
            0.02,
          ),
          '#d8c8ab',
        ),
        painted(at(sphere(0.08), -0.1, 0.24, -0.05, 1, 0.6, 1), '#9fd6a0'),
      ]);
    case 'cave':
      // A rounded hill with a dark doorway facing the camera.
      return merged(`explore-${shape}`, [
        painted(at(sphere(0.36), 0, 0.02, 0, 1, 0.75, 0.9), '#bfb3cf'),
        painted(at(sphere(0.16), 0, 0.03, -0.15, 1, 1.1, 0.5), '#3a2f4a'),
      ]);
  }
}
