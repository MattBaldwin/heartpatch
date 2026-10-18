import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Ray } from '@babylonjs/core/Culling/ray';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Constants } from '@babylonjs/core/Engines/constants';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Light } from '@babylonjs/core/Lights/light';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import {
  defaultKeeperConfig,
  KEEPER_DATA,
  type HouseView,
  type KeeperConfig,
  type VisualRegistry,
} from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import type { SceneContent } from '../engine/stage.js';
import { activeTriangles } from '../engine/render-stats.js';
import { linear, merged } from '../map/map-props.js';
import { buildHeartSeed, placeAt, setInstances } from '../map/map-scene.js';
import { accessoryItem } from '../procedural/accessory.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { KeeperField } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { lodFor } from '../procedural/motion.js';
import type { SquishySpecies } from '../procedural/params.js';
import {
  SquishyField,
  type SquishyHandle,
  type SquishyPlacement,
} from '../procedural/squishy-field.js';
import type { KeeperHandle, KeeperPlacement } from '../procedural/keeper/keeper-field.js';
import {
  frontAlpha,
  project,
  wallFade,
  type FadeWall,
  type FramedSpot,
  type HousePose,
} from './house-camera.js';
import {
  HOUSE_BLANKETS,
  HOUSE_CAST,
  HOUSE_FIT_FLOOR,
  HOUSE_GIFT,
  HOUSE_GLIDE,
  HOUSE_GRID,
  HOUSE_KID,
  HOUSE_LIGHT,
  HOUSE_OUTSIDE,
  HOUSE_PALETTE,
  HOUSE_SHADOW,
  HOUSE_TIERS,
  HOUSE_TREE_CROWNS,
} from './house-config.js';
import {
  covers,
  floorCut,
  houseBounds,
  houseFloors,
  roomBox,
  runFloor,
  shownAt,
  wallRuns,
  type FloorCut,
  type HouseBounds,
  type RoomBox,
  type WallRun,
} from './house-layout.js';
import {
  beamCeiling,
  bedBlanket,
  bedFrame,
  box,
  floorPlanks,
  frontYard,
  gableRoof,
  giftBox,
  roofInside,
  TREE_TOP,
  treeParts,
  paintSky,
  signBoard,
  skyDome,
  wallPieces,
  windowFrame,
} from './house-models.js';
import {
  besideBed,
  type BedSpot,
  type CastFootprint,
  type GiftPlacement,
} from './house-gift-view.js';
import { DUSK_LOOK, type HouseLightLook } from './house-light-look.js';
import { placed, roomBuilder, type FloorSpot, type RoomKit, type RoomPlan } from './house-rooms.js';
import { paneMaterial, radialTexture, signMaterial } from './house-textures.js';
import {
  createHop,
  hopActive,
  hopPose,
  shadowAlpha,
  shadowScale,
  stepHop,
  type HopPose,
} from '../explore/keeper-hop.js';
import { EXPLORE_VIEW } from '../explore/explore-config.js';
import { HOUSE_WALK, walkMap, type Footprint, type WalkMap, type WalkSpot } from './house-walk.js';

/*
 * The Keeper's house interior (#381 plan §1c): a dollhouse on the shared
 * stage, built from the house view's rooms. Every room's shell (floor,
 * walls with doors and windows, cut edges) comes from its grid layout; what
 * stands inside comes from the builder registered for its look
 * (house-rooms.ts). Lights and shadows follow the quality tier; squishies
 * and the Keeper keep their own colours under a neutral fill of their own.
 *
 * Render on demand (tech spec §6): nothing moves by itself, so an idle house
 * draws nothing; the screen asks for frames while the camera moves.
 */

/** A resident the scene can draw: its kind, and what it wears. */
export interface HouseCastMember {
  readonly species: SquishySpecies;
  readonly accessory: string | null;
}

export interface HouseSceneOptions {
  readonly tier: QualityTier;
  readonly registry: VisualRegistry;
  /** The player's Keeper (the starter look while it loads). */
  readonly keeper: KeeperConfig | null;
  readonly keeperWearing?: readonly string[];
  /** The squishies the residents are, by squishy id (from the home reply). */
  readonly cast: ReadonlyMap<string, HouseCastMember>;
  /** "<name>'s house" on the sign. */
  readonly signText: string;
  /** The light at this time of day (#381 H2); dusk when left out. */
  readonly look?: HouseLightLook;
  /** Where today's wrapped gift waits (#381 H2), or null: no box. */
  readonly gift?: GiftPlacement | null;
}

/** Read-only numbers for the dev hook and house-shots (tests assert on these, not pixels). */
export interface HouseSceneStats {
  readonly rooms: number;
  /** Residents drawn in their rooms. */
  readonly residents: number;
  readonly keeper: boolean;
  /** Lights switched on, the squishy fill included. */
  readonly lights: number;
  readonly shadowMap: boolean;
  /** Draw calls in the last frame. */
  readonly drawCalls: number;
  /** Triangles the last frame's meshes drew. */
  readonly triangles: number;
  /** The camera's tilt, degrees (negative looks up). */
  readonly pitch: number;
  /** How far the roof has lifted off (1: gone). */
  readonly roof: number;
  /**
   * The front walls past the dollhouse (null in the dollhouse, which has
   * none): the most see-through one's alpha, a faint veil while the camera
   * passes it and 0 (not drawn) once you stand in the room.
   */
  readonly frontWallAlpha: number | null;
  /** Residents drawn at the hero detail (low tier: the nearest ones at kid height, `HOUSE_CAST.lowHeroes`). */
  readonly heroes: number;
  /** The floor the dollhouse shows (the floor cut: every floor above it is taken away). */
  readonly floor: number;
  /** The floors it can show, bottom up. */
  readonly floors: readonly number[];
  /** Today's gift box is drawn (#381 H2): built, not yet opened, on a floor the cut shows. */
  readonly gift: boolean;
  /** The time of day the light shows, and whether the lamps and the fire are lit. */
  readonly light: { readonly phase: string; readonly lit: boolean };
}

/** Squishies and the Keeper: their meshes take the neutral fill and no warm light. */
const CAST = /^(squishy-|keeper-)(?!.*shadow)/;

/**
 * An upstairs floor's underside, one board under its planks (merged with
 * them, so no extra draw): kid height looks up at it from the room below
 * and sees no sky through the gaps between the boards.
 */
function underside(scene: Scene, room: RoomBox, z0: number): Mesh {
  return box(
    scene,
    // TUNE: a thin board just under the 0.16 m planks.
    [room.x1 - room.x0, 0.02, room.z1 - z0],
    [(room.x0 + room.x1) / 2, room.y0 - 0.17, (z0 + room.z1) / 2],
    HOUSE_PALETTE.planks[2],
  );
}

/** A piece's biggest size, metres (its box, scaled). */
function extent(mesh: Mesh): number {
  mesh.computeWorldMatrix(true);
  const { minimumWorld: lo, maximumWorld: hi } = mesh.getBoundingInfo().boundingBox;
  return Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z);
}

interface RoomParts {
  readonly box: RoomBox;
  readonly solid: Mesh[];
  readonly glow: Mesh[];
  readonly floor: Mesh[];
  readonly panes: Mesh[];
}

/**
 * Every floor's pieces, merged by material into one mesh each (draw calls,
 * B4): the floor cut shows or hides a floor as a whole.
 */
interface FloorParts {
  readonly solid: Mesh[];
  readonly glow: Mesh[];
  readonly floor: Mesh[];
  readonly panes: Mesh[];
  /** Today's gift box (#381 H2): merged last into the floor's furniture, so opening it can fold it away. */
  readonly gift: Mesh[];
}

/** A thin instance on a floor (beds, contact shadows, pools, keepsakes): the cut drops its floor's. */
interface Placed {
  readonly matrix: Matrix;
  readonly floor: number;
}

/** A resident or the Keeper as placed, so the floor cut can take it away and put it back. */
interface CastSpot {
  readonly room: string;
  /** Where it stands (its feet), for the framing. */
  readonly at: { x: number; y: number; z: number };
  readonly kind: 'resident' | 'keeper';
  readonly add: () => void;
  readonly remove: () => void;
  readonly drawn: () => boolean;
}

export class HouseScene {
  readonly content: SceneContent;
  readonly bounds: HouseBounds;
  readonly #scene: Scene;
  readonly #tier: QualityTier;
  readonly #tierLook: (typeof HOUSE_TIERS)[QualityTier];
  readonly #vinyl: PBRMaterial;
  readonly #matte: PBRMaterial;
  readonly #glow: StandardMaterial;
  readonly #squishies: SquishyField;
  readonly #keepers: KeeperField;
  readonly #fill: DirectionalLight;
  readonly #warm: Light[] = [];
  readonly #shadows: ShadowGenerator | null = null;
  readonly #roof: Mesh | null;
  readonly #roofMaterial: PBRMaterial;
  readonly #house: Mesh[] = [];
  #pose: HousePose | null = null;
  #zoom = 0;
  #roofLift = 1;
  readonly #beds: Placed[] = [];
  readonly #contact: Placed[] = [];
  readonly #pools: Placed[] = [];
  readonly #requests: { kind: 'fire' | 'lamp'; at: Vector3 }[] = [];
  readonly #seeds: Placed[] = [];
  /** Every floor's pieces, merged per floor (one mesh per material, not per room: draw calls). */
  readonly #byFloor = new Map<number, FloorParts>();
  /** The house's meshes that belong to a floor above the ground, by floor (the cut hides them). */
  readonly #floorMeshes: { mesh: Mesh; floor: number }[] = [];
  /** Thin-instanced meshes whose instances sit on floors, rebuilt as the cut moves. */
  readonly #instanced: { mesh: Mesh; list: readonly Placed[]; color?: (i: number) => number[] }[] =
    [];
  readonly #boxes: RoomBox[];
  /** Walls cut low in the dollhouse that kid height stands back up, by room. */
  readonly #kidWalls = new Map<string, Mesh[]>();
  readonly #runs: readonly WallRun[];
  readonly #floors: readonly number[];
  #cut: FloorCut;
  /** Which floors' thin instances are in the buffers now (`all` during the roof lift). */
  #instancedFor: string | null = null;
  readonly #cast: CastSpot[] = [];
  #signAt: {
    x: number;
    y: number;
    z: number;
    width: number;
    room: string;
    /** Where it hangs at kid height (the header over a cut-back room's opening), or null: it stays. */
    kidY: number | null;
  } | null = null;
  /** The sign's meshes that move to the header at kid height. */
  readonly #signParts: Mesh[] = [];
  readonly #instrumentation: SceneInstrumentation;
  readonly #rooms: number;
  readonly #lookAt = new Vector3();
  /** Front walls (off in the dollhouse, faded at kid height) and the porch you stand on. */
  readonly #fronts: {
    room: string;
    floor: number;
    mesh: Mesh;
    material: PBRMaterial;
    wall: FadeWall;
  }[] = [];
  readonly #porch: { room: string; mesh: Mesh }[] = [];
  /** The roof seen from inside, at kid height only (the focus room's alone). */
  readonly #ceilings: { room: string; mesh: Mesh }[] = [];
  #frontAlpha: number | null = null;
  /** The room kid height walks into (the Keeper's room), its floor's middle at eye level. */
  #focus: { id: string; room: HouseBounds; point: Vector3 } | null = null;
  /** Low tier: the nearest residents at kid height drawn smooth (owner check #4), their own field. */
  #hero: SquishyField | null = null;
  /** Meshes already sorted into the fill (or not cast): checked once each. */
  readonly #sorted = new WeakSet<AbstractMesh>();
  readonly #trees: { x: number; z: number; s: number; hex: string }[] = [];
  #treeMeshes: { trunks: Mesh; crowns: Mesh } | null = null;
  /** Every room's beds as placed, in order (the gift goes by its giver's). */
  readonly #roomBeds = new Map<string, BedSpot[]>();
  /** Where the gift box stands and its floor, while it's wrapped (#381 H2). */
  #giftAt: { x: number; y: number; z: number; floor: number } | null = null;
  /** The gift's vertices: the last `count` of `mesh` (folded to a point once opened). */
  #giftRange: { mesh: Mesh; count: number } | null = null;
  #giftShadow: Placed | null = null;
  /** Lights and looks the time of day changes (#381 H2). */
  #sun: DirectionalLight | null = null;
  #houseLight: DirectionalLight | null = null;
  readonly #points: { kind: 'fire' | 'lamp'; light: PointLight }[] = [];
  #flicker = { fire: 1, lamp: 1 };
  // ── MOCKUP (#381 Keeper walk) ──
  readonly #furniture: Footprint[] = [];
  #walkMap: WalkMap | null = null;
  #keeperHandle: KeeperHandle | null = null;
  #keeperBase: KeeperPlacement | null = null;
  #walkAt: WalkSpot | null = null;
  #walkYaw = 0;
  readonly #walkHop = createHop();
  readonly #walkPose: HopPose = { lift: 0, squash: 1 };
  #walked = 0;
  readonly #residentAt = new Map<string, SquishyPlacement>();
  readonly #greeted = new Set<string>();
  #walkCeiling = true;
  #look: HouseLightLook = DUSK_LOOK;
  #poolMaterial: StandardMaterial | null = null;
  #lawnMaterial: PBRMaterial | null = null;
  #sky: Mesh | null = null;
  readonly #paneMeshes: Mesh[] = [];
  /** Residents drawn now, by squishy id, so one can hop (welcome home). */
  readonly #handles = new Map<string, { field: SquishyField; handle: SquishyHandle }>();
  /** The residents in the order they were placed (the Keeper's room first). */
  #order: string[] = [];

  constructor(scene: Scene, view: HouseView, options: HouseSceneOptions) {
    this.#scene = scene;
    this.#tier = options.tier;
    this.#tierLook = HOUSE_TIERS[options.tier];
    this.#look = options.look ?? DUSK_LOOK;
    const low = this.#tierLook.shadowMap === 0;
    scene.clearColor = Color4.FromColor3(linear(HOUSE_PALETTE.sky), 1);

    // One matte vinyl for every painted prop (art bible §4: matte-er than squishies).
    this.#vinyl = new PBRMaterial('house-vinyl', scene);
    this.#vinyl.albedoColor = Color3.White();
    this.#vinyl.metallic = 0;
    this.#vinyl.roughness = 0.6; // TUNE
    this.#vinyl.clearCoat.isEnabled = this.#tierLook.clearCoat;
    this.#vinyl.clearCoat.intensity = 0.45; // TUNE
    this.#vinyl.clearCoat.roughness = 0.35; // TUNE
    this.#matte = new PBRMaterial('house-floor', scene);
    this.#matte.albedoColor = Color3.White();
    this.#matte.metallic = 0;
    this.#matte.roughness = 0.88; // TUNE: the fire leaves no hard streak on the boards
    // Lamp shades, flames and lanterns: their vertex colour, unlit.
    this.#glow = new StandardMaterial('house-glow', scene);
    this.#glow.disableLighting = true;
    this.#glow.diffuseColor = Color3.Black();
    this.#glow.emissiveColor = Color3.White();
    this.#glow.specularColor = Color3.Black();
    this.#roofMaterial = this.#vinyl.clone('house-roof');

    // Squishies and the Keeper keep their own colours (art bible: nothing in
    // a scene changes them): a neutral fill lights them alone, and every
    // warm light leaves them out. Their meshes appear as the fields draw.
    this.#fill = new DirectionalLight('house-fill', new Vector3(0, -0.5, 1), scene);
    this.#fill.diffuse = linear(HOUSE_LIGHT.fill.color);
    this.#fill.specular = this.#tierLook.specular
      ? linear(HOUSE_LIGHT.fill.color).scale(HOUSE_LIGHT.fill.specular)
      : Color3.Black();
    this.#fill.intensity = this.#tierLook.fill;
    this.#fill.includedOnlyMeshes = [];
    // The fields make their meshes as they first draw (in beforeRender):
    // sort any new ones before the camera renders. Every mesh is checked,
    // not just a change in the count: the low tier's hero field swaps its
    // meshes for smoother ones one for one, and those went unlit by the
    // fill (B4 render check: Puddlepuff grey and muddy at kid height).
    scene.onBeforeCameraRenderObservable.add(() => {
      this.#sortCast();
    });

    this.#setUpWarmLights(low);
    if (!low) {
      const sun = this.#warm.find((l): l is DirectionalLight => l instanceof DirectionalLight);
      if (sun) this.#shadows = this.#shadowsFor(sun);
    }

    const rooms = view.rooms.map((r) => roomBox(r));
    this.#boxes = rooms;
    this.#rooms = rooms.length;
    this.bounds = houseBounds(rooms);
    this.#floors = houseFloors(rooms);
    // The Keeper's floor (the ground) first: the floors above it are taken away.
    this.#cut = floorCut(rooms, this.#floors[0] ?? 0);
    const runs = wallRuns(view.rooms);
    this.#runs = runs;
    this.#buildOutside(this.bounds);
    const plans = new Map<string, RoomPlan>();
    for (const box of rooms) {
      const parts: RoomParts = { box, solid: [], glow: [], floor: [], panes: [] };
      const frontOpen = runs.some((r) => r.room === box.id && r.front && r.exterior);
      const z0 = frontOpen ? box.z0 - HOUSE_GRID.frontLip : box.z0;
      parts.floor.push(...floorPlanks(scene, box.x0, z0, box.x1 - box.x0, box.z1 - z0, box.y0));
      if (box.y0 > 0) parts.floor.push(underside(scene, box, z0));
      for (const run of runs.filter((r) => r.room === box.id)) this.#wall(parts, run);
      plans.set(box.id, roomBuilder(box.look)(this.#kit(parts)));
      const own = this.#floorParts(box.floor);
      own.solid.push(...parts.solid);
      own.glow.push(...parts.glow);
      own.floor.push(...parts.floor);
      own.panes.push(...parts.panes);
    }
    this.#buildGift(options.gift ?? null, view, plans, options.cast);
    this.#mergeFloors();
    this.#buildBeds();
    this.#buildSeeds();
    this.#buildDecals(low);
    this.#buildSign(options.signText);
    this.#roof = this.#buildRoof(rooms, runs);
    this.#buildCeilings(rooms);
    this.#lightRequests(low);

    this.#squishies = new SquishyField(scene, {
      registry: options.registry,
      lod: lodFor('closeUp', options.tier),
      breathing: false,
    });
    this.#keepers = new KeeperField(scene, {
      data: KEEPER_DATA,
      lod: lodFor('closeUp', options.tier),
    });
    this.#placeCast(view, plans, options);

    for (const m of scene.materials) {
      if (m instanceof PBRMaterial || m instanceof StandardMaterial) m.maxSimultaneousLights = 6;
    }

    // The screen's pose wins over the stage's map camera, after every
    // beforeRender (the map camera's tick included) and before the fields
    // turn their faces to it.
    scene.onBeforeCameraRenderObservable.add(
      (camera) => {
        const pose = this.#pose;
        if (!pose || !(camera instanceof TargetCamera)) return;
        camera.fov = pose.fov;
        camera.minZ = 0.1;
        camera.maxZ = 400;
        camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
        camera.setTarget(this.#lookAt.set(pose.target.x, pose.target.y, pose.target.z));
      },
      undefined,
      true,
    );
    this.#instrumentation = new SceneInstrumentation(scene);
    this.#applyCut();
    this.setLook(options.look ?? DUSK_LOOK);

    const b = this.bounds;
    this.content = {
      bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
      start: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 },
    };
  }

  /**
   * Where the camera is (the screen's pose: the glide, the dollhouse, a
   * pinch or Walk in) and how far toward kid height it has come (0
   * dollhouse, 1 kid height): the open front walls and the porch come in
   * past `frontFrom`, faded where they stand in the way.
   */
  setPose(pose: HousePose, zoom = 0): void {
    this.#pose = pose;
    this.#zoom = zoom;
    this.#fadeFronts(pose, zoom);
    // Hero detail only once they're big on screen: the dollhouse is near the low cap already.
    this.#hero?.setLod(zoom >= HOUSE_KID.frontFrom ? 'high' : this.#squishies.lod);
    // The fill comes from just above the camera, so every face is lit.
    const f = new Vector3(
      pose.target.x - pose.eye.x,
      pose.target.y - pose.eye.y,
      pose.target.z - pose.eye.z,
    );
    this.#fill.direction = f
      .normalize()
      .add(new Vector3(0.15, -0.45, 0))
      .normalize();
    // The haze starts just past the house, however far the camera stands.
    const b = this.bounds;
    const centre = new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const far = Vector3.Distance(new Vector3(pose.eye.x, pose.eye.y, pose.eye.z), centre);
    const reach = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    this.#scene.fogStart = far + reach + HOUSE_OUTSIDE.hazeFrom;
    this.#scene.fogEnd = far + reach + HOUSE_OUTSIDE.hazeTo;
  }

  /**
   * Keeps only the trees that sit whole in the dollhouse frame (#381 owner
   * check: nothing clipped at the edges): a tree whose crown runs off the
   * top while its foot is in view, or that stands up under the top bar,
   * goes. `frame` is the pose, the canvas aspect and how far down the top
   * bar reaches (normalised device y); null keeps every tree.
   */
  frameOutside(frame: { pose: HousePose; aspect: number; topBar: number } | null): void {
    const meshes = this.#treeMeshes;
    if (!meshes) return;
    const kept = this.#trees.filter((t) => {
      if (!frame) return true;
      const top = project(frame.pose, frame.aspect, { x: t.x, y: TREE_TOP * t.s, z: t.z });
      const foot = project(frame.pose, frame.aspect, { x: t.x, y: -0.3, z: t.z });
      if (foot.depth <= 0) return false;
      // Whole in the frame below the top bar, or wholly past its top edge:
      // never a trunk or a crown cut by an edge (render check, PR B2).
      const whole = top.y < Math.min(0.97, frame.topBar) && Math.abs(foot.x) < 1.1;
      const past = foot.y > 1.05;
      return whole || past;
    });
    const matrices = new Float32Array(Math.max(1, kept.length) * 16);
    const colors = new Float32Array(Math.max(1, kept.length) * 4);
    kept.forEach((t, i) => {
      Matrix.Scaling(t.s, t.s, t.s)
        .multiply(Matrix.Translation(t.x, -0.3, t.z))
        .copyToArray(matrices, i * 16);
      const c = linear(t.hex);
      colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    for (const mesh of [meshes.trunks, meshes.crowns]) {
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
      mesh.setEnabled(kept.length > 0);
    }
    meshes.crowns.thinInstanceSetBuffer('color', colors, 4, false);
  }

  /**
   * Kid height draws only what the focus room's frame needs (the draw and
   * triangle caps): that room's porch, ceiling and front walls, plus any
   * other front wall standing in the line of sight (not on the low tier:
   * those only flash a faint veil on the way in, and the draw is the cap's
   * last). Every other room stays a dollhouse cutaway, out of frame anyway.
   */
  #fadeFronts(pose: HousePose, zoom: number): void {
    const focus = zoom >= HOUSE_KID.frontFrom ? this.#focus : null;
    let least: number | null = null;
    for (const f of this.#fronts) {
      const fade = focus ? wallFade(pose.eye, focus.point, f.wall) : 1;
      const other = focus !== null && f.room !== focus.id;
      const cut = !shownAt(f.floor, this.#cut.floor);
      if (!focus || cut || (other && (fade >= 1 || this.#tier === 'low'))) {
        f.mesh.setEnabled(false);
        continue;
      }
      const alpha = frontAlpha(fade, zoom);
      f.material.alpha = alpha;
      // Gone means not drawn at all: no veil, no seams at the door's edges.
      f.mesh.setEnabled(alpha > 0.001);
      least = least === null ? alpha : Math.min(least, alpha);
    }
    for (const p of this.#porch) p.mesh.setEnabled(p.room === focus?.id);
    for (const c of this.#ceilings) c.mesh.setEnabled(this.#walkCeiling && c.room === focus?.id);
    const sign = this.#signAt;
    if (sign?.kidY != null) {
      const y = sign.room === focus?.id ? sign.kidY : sign.y;
      for (const m of this.#signParts) m.position.y = y;
    }
    this.#frontAlpha = least;
  }

  /** The room kid height walks into, as a box (the camera takes only that). */
  get focusRoom(): HouseBounds | null {
    return this.#focus?.room ?? null;
  }

  /**
   * The residents drawn now, as the framing sees them (their middles and
   * about how far they reach), so a phone's frame edge can miss them.
   */
  get residentSpots(): FramedSpot[] {
    // From the fields themselves: each squishy's own middle and height, as drawn.
    return this.#drawnSquishies().map(({ centre, height }) => ({
      x: centre.x,
      y: centre.y,
      z: centre.z,
      r: height * HOUSE_CAST.reach,
    }));
  }

  /** Every resident drawn now, its middle and its height (world metres). */
  #drawnSquishies(): { centre: Vector3; height: number }[] {
    const fields = [this.#squishies, ...(this.#hero ? [this.#hero] : [])];
    return fields.flatMap((f) =>
      f.handles.flatMap((h) => {
        const centre = f.centre(h);
        return centre ? [{ centre, height: f.heightOf(h) * HOUSE_CAST.squishyScale }] : [];
      }),
    );
  }

  /** The floors the dollhouse can show, bottom up (one entry: no floor switch). */
  get floors(): readonly number[] {
    return this.#floors;
  }

  /** The floor the dollhouse shows. */
  get floor(): number {
    return this.#cut.floor;
  }

  /**
   * The floor cut (plan §1c): shows floor `n` (the nearest floor at or
   * below it) with every floor above taken away, its residents with it,
   * so the shown floor's rooms lie open to the camera. Kid height walks
   * into the Keeper's room on the ground floor, so the screen goes back to
   * floor 0 before it zooms.
   */
  setFloor(n: number): void {
    const cut = floorCut(this.#boxes, n);
    if (cut.floor === this.#cut.floor) return;
    this.#cut = cut;
    this.#applyCut();
    if (this.#pose) this.#fadeFronts(this.#pose, this.#zoom);
  }

  /**
   * The box the dollhouse camera fits: the shown floor's rooms (or the
   * whole house, `HOUSE_FIT_FLOOR` off).
   */
  get frameBounds(): HouseBounds {
    return HOUSE_FIT_FLOOR ? this.#cut.bounds : this.bounds;
  }

  /**
   * Shows what the cut keeps: a floor above it is hidden, except while the
   * roof lifts in the entry glide, when it fades away with the roof (its
   * beds and keepsakes go once it's mostly gone).
   */
  #applyCut(): void {
    const floor = this.#cut.floor;
    const lifting = this.#roof !== null && this.#roofLift < 1;
    for (const { mesh, floor: tag } of this.#floorMeshes) {
      const shown = shownAt(tag, floor);
      mesh.setEnabled(shown || lifting);
      mesh.visibility = shown ? 1 : 1 - this.#roofLift;
    }
    const all = lifting && this.#roofLift < 0.5;
    const key = all ? 'all' : String(floor);
    if (key !== this.#instancedFor) {
      this.#instancedFor = key;
      for (const { mesh, list, color } of this.#instanced) {
        const kept = list
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => all || shownAt(p.floor, floor));
        const data = new Float32Array(Math.max(1, kept.length) * 16);
        kept.forEach(({ p }, i) => {
          p.matrix.copyToArray(data, i * 16);
        });
        mesh.thinInstanceSetBuffer('matrix', data, 16, true);
        if (color) {
          const colors = new Float32Array(Math.max(1, kept.length) * 4);
          kept.forEach(({ i }, j) => {
            colors.set(color(i), j * 4);
          });
          mesh.thinInstanceSetBuffer('color', colors, 4, true);
        }
        mesh.thinInstanceCount = kept.length;
        mesh.setEnabled(kept.length > 0);
      }
    }
    for (const spot of this.#cast) {
      // MOCKUP (#381 Keeper walk): the Keeper walks between floors, so the cut never takes it away.
      const wanted = spot.kind === 'keeper' || this.#cut.cast.has(spot.room);
      if (wanted && !spot.drawn()) spot.add();
      else if (!wanted && spot.drawn()) spot.remove();
    }
  }

  /** Squishy and Keeper meshes take the neutral fill and none of the warm lights. */
  #sortCast(): void {
    const fill = this.#fill.includedOnlyMeshes;
    for (const mesh of this.#scene.meshes) {
      if (this.#sorted.has(mesh)) continue;
      this.#sorted.add(mesh);
      if (!CAST.test(mesh.name)) continue;
      fill.push(mesh);
      for (const light of this.#warm) light.excludedMeshes.push(mesh);
    }
  }

  /** Lifts the roof off (0 on, 1 gone), the entry glide's beat. */
  setRoof(lift: number): void {
    this.#roofLift = lift;
    const roof = this.#roof;
    if (!roof) return;
    roof.position.y = lift * HOUSE_GLIDE.roofLift;
    this.#roofMaterial.alpha = 1 - lift;
    roof.setEnabled(lift < 1);
    this.#applyCut();
  }

  // ── The living house (#381 H2) ─────────────────────────────────────

  /**
   * The light at this time of day: the sky and haze outside, the windows'
   * picture, the sun through the back windows (or the low tier's one house
   * light and its ambient), the fire's and lamps' strength and their pools,
   * and the glow of shades and flames. Colours and strengths only: no light,
   * mesh or draw call comes or goes, and the squishy-only fill is untouched.
   */
  setLook(look: HouseLightLook): void {
    this.#look = look;
    const scene = this.#scene;
    scene.clearColor = Color4.FromColor3(linear(look.clear), 1);
    scene.fogColor = linear(look.haze);
    const sky = this.#sky;
    const skyKey = look.sky.join();
    if (sky && sky.metadata !== skyKey) {
      paintSky(sky, HOUSE_OUTSIDE.lawnRadius * 2.2, look.sky);
      sky.metadata = skyKey;
    }
    if (this.#lawnMaterial) {
      this.#lawnMaterial.albedoColor = linear(look.lawn);
      this.#lawnMaterial.emissiveColor = linear(look.lawnLift);
    }
    if (this.#sun) {
      this.#sun.diffuse = linear(look.sun.color);
      this.#sun.specular = linear(look.sun.color).scale(look.sunSpecular);
      this.#sun.intensity = look.sun.intensity;
    }
    // High and medium: the image-based light carries the daylight the dimmer
    // lamps leave, on the house's own materials only: the squishies' and the
    // Keeper's stay exactly as they are (art bible: nothing changes them).
    if (this.#tierLook.shadowMap > 0) {
      for (const m of scene.materials) {
        if (m instanceof PBRMaterial && m.name.startsWith('house-'))
          m.environmentIntensity = look.environment;
      }
    }
    if (this.#houseLight) {
      this.#houseLight.diffuse = linear(look.house.color);
      this.#houseLight.intensity = look.house.intensity;
      scene.ambientColor = linear(look.ambient);
    }
    if (this.#poolMaterial) {
      const low = this.#tierLook.shadowMap === 0;
      this.#poolMaterial.emissiveColor = linear('#ffae62').scale((low ? 0.55 : 0.32) * look.lamps); // TUNE
    }
    this.#glow.emissiveColor = Color3.White().scale(look.glow);
    const panes = paneMaterial(scene, look.pane);
    for (const m of this.#paneMeshes) m.material = panes;
    this.#lightPoints();
  }

  /** The fire and the lamp as the flicker has them now (shares of their steady light). */
  setFlicker(fire: number, lamp: number): void {
    this.#flicker = { fire, lamp };
    this.#lightPoints();
  }

  /** Lights the flicker moves (high and medium: the fire's and the lamp's point lights). */
  get flickers(): boolean {
    return this.#points.length > 0;
  }

  #lightPoints(): void {
    for (const { kind, light } of this.#points) {
      const base = kind === 'fire' ? HOUSE_LIGHT.fire.intensity : HOUSE_LIGHT.lamp.intensity;
      const strength = kind === 'fire' ? this.#look.lamps : this.#look.lamp;
      light.intensity = base * strength * this.#flicker[kind];
    }
  }

  /**
   * Where the wrapped gift stands (world metres, its middle), or null when
   * there's none, it's open, or the floor cut has taken its floor away.
   */
  get giftPoint(): { x: number; y: number; z: number } | null {
    const at = this.#giftAt;
    if (!at || !shownAt(at.floor, this.#cut.floor)) return null;
    return { x: at.x, y: at.y, z: at.z };
  }

  /**
   * Takes the gift box away once it's open: its vertices (the last of its
   * floor's furniture mesh) fold to one point, and its contact shadow goes.
   * No rebuild and no draw call changes.
   */
  removeGift(): void {
    const range = this.#giftRange;
    this.#giftAt = null;
    this.#giftRange = null;
    if (range) {
      const { mesh, count } = range;
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind, false, true);
      if (pos) {
        const total = pos.length / 3;
        const start = Math.max(0, total - count);
        const [x, y, z] = [pos[start * 3] ?? 0, pos[start * 3 + 1] ?? 0, pos[start * 3 + 2] ?? 0];
        for (let i = start; i < total; i++) {
          pos[i * 3] = x;
          pos[i * 3 + 1] = y;
          pos[i * 3 + 2] = z;
        }
        mesh.setVerticesData(VertexBuffer.PositionKind, pos, false);
      }
    }
    const shadow = this.#giftShadow;
    this.#giftShadow = null;
    const i = shadow ? this.#contact.indexOf(shadow) : -1;
    if (i >= 0) {
      this.#contact.splice(i, 1);
      this.#instancedFor = null;
      this.#applyCut();
    }
  }

  /**
   * Welcome home: the first resident drawn in the Keeper's room (else the
   * first drawn) does a happy bounce. False when nobody is drawn.
   */
  hop(now: number): boolean {
    for (const id of this.#order) {
      const drawn = this.#handles.get(id);
      if (!drawn) continue;
      drawn.field.play(drawn.handle, 'bounce', now);
      return true;
    }
    return false;
  }

  /** Advances the squishies' clock; true while one still moves (keep drawing). */
  update(now: number): boolean {
    const main = this.#squishies.update(now);
    const hero = this.#hero?.update(now) ?? false;
    return main || hero;
  }

  /**
   * Today's wrapped gift (#381 H2): a little box by the giver's bed, or by
   * the hearth in the Keeper's room, merged with its floor's furniture (no
   * draw call of its own), with a contact shadow on low.
   */
  #buildGift(
    placement: GiftPlacement | null,
    view: HouseView,
    plans: ReadonlyMap<string, RoomPlan>,
    cast: ReadonlyMap<string, HouseCastMember>,
  ): void {
    if (!placement) return;
    const keeperRoom = view.rooms.find((r) => plans.get(r.id)?.keeper) ?? view.rooms[0];
    /** Who stands in a room, where #placeCast puts them: the box keeps clear of them all. */
    const footprints = (id: string): CastFootprint[] => {
      const plan = plans.get(id);
      const room = view.rooms.find((r) => r.id === id);
      if (!plan || !room) return [];
      const present = room.residents.filter((r) => r.away === null);
      const out: CastFootprint[] = present.flatMap((resident, i) => {
        const at = plan.residents[i];
        return at && cast.has(resident.squishyId)
          ? [{ x: at.x, z: at.z, r: HOUSE_CAST.reach * HOUSE_CAST.squishyScale, squishy: true }]
          : [];
      });
      if (id === keeperRoom?.id && plan.keeper)
        out.push({ ...plan.keeper, r: HOUSE_GIFT.keeperReach, squishy: false });
      return out;
    };
    let spot: { x: number; z: number } | null = null;
    let room: RoomBox | undefined;
    if (placement.kind === 'bed') {
      room = this.#boxes.find((b) => b.id === placement.roomId);
      const beds = this.#roomBeds.get(placement.roomId) ?? [];
      const bed = beds[placement.bed] ?? beds.at(-1);
      if (room && bed) spot = besideBed(bed, beds, room, footprints(room.id));
    }
    if (!spot || !room) {
      room = this.#boxes.find((b) => b.id === keeperRoom?.id);
      if (!room) return;
      spot = plans.get(room.id)?.gift ?? { x: room.x0 + 0.9, z: room.z0 + 0.7 };
    }
    const mesh = placed(giftBox(this.#scene, this.#tierLook.rounds), spot.x, room.y0, spot.z, 0.45); // TUNE: a little turned, so two faces read
    this.#floorParts(room.floor).gift.push(mesh);
    this.#giftAt = { x: spot.x, y: room.y0 + HOUSE_GIFT.size * 0.55, z: spot.z, floor: room.floor };
    const shadow: Placed = {
      matrix: Matrix.Scaling(0.62, 1, 0.62).multiply(
        Matrix.Translation(spot.x, room.y0 + 0.025, spot.z),
      ),
      floor: room.floor,
    };
    this.#contact.push(shadow);
    this.#giftShadow = shadow;
  }

  // ── MOCKUP (#381 Keeper walk): the Keeper walks about the house ──

  /** The floor the Keeper can walk on, built once from the rooms and their furniture. */
  get walkMap(): WalkMap {
    this.#walkMap ??= walkMap(this.#boxes, this.#runs, this.#furniture);
    return this.#walkMap;
  }

  get rooms(): readonly RoomBox[] {
    return this.#boxes;
  }

  /** Where the Keeper stands now (its feet), and which way it faces. */
  get keeperWalk(): { at: WalkSpot; yaw: number } | null {
    return this.#walkAt ? { at: { ...this.#walkAt }, yaw: this.#walkYaw } : null;
  }

  /** The Keeper walked (or was put) here, facing `yaw`; `ds` metres covered for its hop. */
  moveKeeper(at: WalkSpot, yaw: number, ds: number): void {
    this.#walkAt = { ...at };
    this.#walkYaw = yaw;
    this.#walked += ds;
    this.#placeKeeper();
  }

  /**
   * One walk frame: the Keeper's hop by the ground covered, and the
   * residents it comes near turn to it and bounce (once each, until it
   * walks away). True while anything still moves.
   */
  stepWalk(dt: number, now: number, reduced: boolean): boolean {
    // The explore hop counts tile-local ground: the house walks in metres.
    const scale = HOUSE_WALK.speed / EXPLORE_VIEW.walkSpeed;
    const walked = dt > 0 ? this.#walked / scale : 0;
    const push = dt > 0 ? Math.min(1, this.#walked / (HOUSE_WALK.speed * dt)) : 0;
    this.#walked = 0;
    stepHop(this.#walkHop, walked, dt, push, reduced);
    hopPose(this.#walkHop, reduced, 1, this.#walkPose);
    this.#placeKeeper();
    this.#greetNear(now);
    return hopActive(this.#walkHop);
  }

  /** The room the camera follows the Keeper into: its front walls fade, its ceiling closes in. */
  setWalkFocus(id: string, point: WalkSpot, ceiling: boolean): void {
    this.#walkCeiling = ceiling;
    const b = this.#boxes.find((x) => x.id === id);
    if (!b) return;
    this.#focus = {
      id,
      room: { minX: b.x0, maxX: b.x1, minY: b.y0, maxY: b.y1, minZ: b.z0, maxZ: b.z1 },
      point: new Vector3(point.x, point.y + HOUSE_WALK.lookHeight, point.z),
    };
  }

  #keeperPlace(): KeeperPlacement | null {
    const base = this.#keeperBase;
    const at = this.#walkAt;
    if (!base || !at) return null;
    const tall = (this.#keeperHandle?.params.height ?? 1.4) * HOUSE_CAST.keeperScale;
    const pose = this.#walkPose;
    return {
      ...base,
      x: at.x,
      z: at.z,
      y: at.y,
      yaw: this.#walkYaw,
      lift: pose.lift * tall,
      squash: pose.squash,
      shadow: shadowScale(pose.lift),
      shadowAlpha: shadowAlpha(pose.lift),
    };
  }

  #placeKeeper(): void {
    const place = this.#keeperPlace();
    if (this.#keeperHandle && place) this.#keepers.move(this.#keeperHandle, place);
  }

  #greetNear(now: number): void {
    const at = this.#walkAt;
    if (!at) return;
    for (const [id, place] of this.#residentAt) {
      const drawn = this.#handles.get(id);
      if (!drawn) continue;
      const d = Math.hypot(place.x - at.x, place.z - at.z);
      const near = d < 1.6 && Math.abs((place.y ?? 0) - at.y) < 0.5; // TUNE
      if (near && !this.#greeted.has(id)) {
        this.#greeted.add(id);
        drawn.field.move(drawn.handle, { ...place, yaw: faceYaw(at.x - place.x, at.z - place.z) });
        drawn.field.play(drawn.handle, 'bounce', now);
      } else if (!near && d > 2.4 && this.#greeted.has(id)) {
        this.#greeted.delete(id);
        drawn.field.move(drawn.handle, place);
      }
    }
  }

  get stats(): HouseSceneStats {
    const pose = this.#pose;
    let pitch = 0;
    if (pose) {
      const f = {
        x: pose.target.x - pose.eye.x,
        y: pose.target.y - pose.eye.y,
        z: pose.target.z - pose.eye.z,
      };
      pitch = (Math.asin(-f.y / (Math.hypot(f.x, f.y, f.z) || 1)) * 180) / Math.PI;
    }
    return {
      rooms: this.#rooms,
      residents: this.#drawnResidents(),
      keeper: this.#keepers.handles.length > 0,
      lights: this.#scene.lights.filter((l) => l.isEnabled()).length,
      shadowMap: this.#shadows !== null,
      drawCalls: this.#instrumentation.drawCallsCounter.current,
      triangles: activeTriangles(this.#scene),
      pitch: Math.round(pitch * 10) / 10,
      roof: this.#roofLift,
      frontWallAlpha: this.#frontAlpha,
      heroes: this.#hero?.lod === 'high' ? this.#hero.handles.length : 0,
      floor: this.#cut.floor,
      floors: this.#floors,
      gift: this.giftPoint !== null,
      light: { phase: this.#look.phase, lit: this.#look.lit },
    };
  }

  /**
   * Which residents' faces the camera sees (house-shots, the dev hook): a
   * face counts when it's inside the frame and nothing of the house stands
   * between it and the camera.
   */
  faceReport(): {
    visible: number;
    total: number;
    cut: number;
    /** Each resident's box on the screen, as shares of its width and height from the top left. */
    boxes: { x0: number; y0: number; x1: number; y1: number }[];
  } {
    const scene = this.#scene;
    const camera = scene.activeCamera;
    const drawn = this.#drawnSquishies();
    if (!camera) return { visible: 0, total: drawn.length, cut: 0, boxes: [] };
    const engine = scene.getEngine();
    const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const eye = camera.globalPosition;
    const view = scene.getTransformMatrix();
    const solid = new Set<AbstractMesh>(
      this.#house.filter((m) => !/(sky|lawn|pools|contact|sign|panes|wall-front)/.test(m.name)),
    );
    const screen = (p: Vector3) => {
      const q = Vector3.Project(p, Matrix.Identity(), view, vp);
      return { x: q.x / vp.width, y: q.y / vp.height, z: q.z };
    };
    const right = Vector3.Cross(Vector3.Up(), camera.getForwardRay().direction).normalize();
    let visible = 0;
    let cut = 0;
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const { centre, height } of drawn) {
      const reach = height * HOUSE_CAST.reach;
      // Partly off the screen's sides or ends (render check: a frame edge sliced one).
      const sides = [right.scale(reach), right.scale(-reach), Vector3.Up().scale(reach)].map((d) =>
        screen(centre.add(d)),
      );
      const xs = sides.map((p) => p.x);
      const ys = sides.map((p) => p.y);
      const inside = (v: number) => v >= 0 && v <= 1;
      const partly = xs.some(inside) !== xs.every(inside) || ys.some(inside) !== ys.every(inside);
      if (partly) cut += 1;
      const top = screen(centre.add(Vector3.Up().scale(reach))).y;
      const bottom = screen(centre.add(Vector3.Up().scale(-reach))).y;
      boxes.push({
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(top, bottom),
        y1: Math.max(top, bottom),
      });
      // The face counts when its middle and both sides are in the frame and
      // nothing of the house stands in front of any of them (round 3: a wall
      // over half a face still counted from its middle alone).
      const toEye = eye.subtract(centre).normalize();
      const face = centre.add(toEye.scale(0.3 * height));
      const points = [
        face,
        face.add(right.scale(0.22 * height)),
        face.add(right.scale(-0.22 * height)),
      ];
      const seen = points.every((pt) => {
        const p = screen(pt);
        if (p.z <= 0 || p.z >= 1 || p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98)
          return false;
        const dir = pt.subtract(eye);
        const length = dir.length();
        const hit = scene.pickWithRay(
          new Ray(eye, dir.normalize(), length - 0.05),
          (m) => solid.has(m) && m.isEnabled(),
        );
        return !hit?.hit;
      });
      if (seen) visible += 1;
    }
    return { visible, total: drawn.length, cut, boxes };
  }

  /** The house's own meshes (shell, fixtures, outside), not the cast: the budget test counts these. */
  get houseMeshes(): readonly Mesh[] {
    return this.#house;
  }

  dispose(): void {
    this.#squishies.dispose();
    this.#hero?.dispose();
    this.#keepers.dispose();
    this.#instrumentation.dispose();
  }

  // ── Lights ──────────────────────────────────────────────────────────

  /**
   * High and medium: the dusk sun through the back windows (it casts the
   * shadows), then the hearth and a lamp as the tier allows. Low: two
   * lights in all, the fill and one warm house light, no specular, and a
   * warm ambient for the window light.
   */
  #setUpWarmLights(low: boolean): void {
    const scene = this.#scene;
    const sun = scene.lights.find(
      (l): l is DirectionalLight => l instanceof DirectionalLight && l !== this.#fill,
    );
    if (low) {
      sun?.dispose();
      scene.ambientColor = linear(HOUSE_LIGHT.ambient);
      this.#vinyl.ambientColor = Color3.White();
      this.#matte.ambientColor = Color3.White();
      scene.environmentIntensity = HOUSE_LIGHT.environment.low;
      return;
    }
    scene.environmentIntensity = HOUSE_LIGHT.environment.lit;
    if (!sun) return;
    const [x, y, z] = HOUSE_LIGHT.sun.direction;
    sun.direction = new Vector3(x, y, z).normalize();
    sun.intensity = HOUSE_LIGHT.sun.intensity;
    sun.diffuse = linear(HOUSE_LIGHT.sun.color);
    sun.specular = linear(HOUSE_LIGHT.sun.color).scale(0.6);
    this.#warm.push(sun);
    this.#sun = sun;
  }

  #shadowsFor(sun: DirectionalLight): ShadowGenerator {
    const sg = new ShadowGenerator(this.#tierLook.shadowMap, sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality =
      this.#tier === 'high' ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
    sg.darkness = 0.35; // TUNE
    sg.bias = 0.0012;
    sg.normalBias = 0.02;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 70;
    sun.autoCalcShadowZBounds = false;
    return sg;
  }

  /** Lights the rooms asked for, as many as the tier allows (the sun and the fill count). */
  #lightRequests(low: boolean): void {
    const scene = this.#scene;
    const cast = this.#fill.includedOnlyMeshes;
    const add = (light: Light) => {
      light.excludedMeshes = [...cast];
      this.#warm.push(light);
    };
    const point = (name: string, at: Vector3, look: { intensity: number; color: string }) => {
      const light = new PointLight(name, at, scene);
      light.diffuse = linear(look.color);
      light.specular = this.#tierLook.specular ? linear(look.color).scale(0.5) : Color3.Black();
      light.intensity = look.intensity;
      light.range = HOUSE_LIGHT.range;
      return light;
    };
    if (low) {
      // One warm light over the rooms stands in for the fire, the lamps and
      // the window: a directional one from above the open front, so no wall
      // top right under it glows orange (B4 render check: the point light
      // just over the partition lit its cap like a lamp).
      const [x, y, z] = HOUSE_LIGHT.house.direction;
      const light = new DirectionalLight('house-light', new Vector3(x, y, z), scene);
      light.diffuse = linear(HOUSE_LIGHT.house.color);
      light.specular = Color3.Black();
      light.intensity = HOUSE_LIGHT.house.intensity;
      add(light);
      this.#houseLight = light;
      return;
    }
    let free = this.#tierLook.lights - 1 - this.#warm.length; // the fill and the sun so far
    for (const kind of ['fire', 'lamp'] as const) {
      const wanted = this.#requests.find((r) => r.kind === kind);
      if (!wanted || free <= 0) continue;
      const light = point(
        `house-${kind}`,
        wanted.at,
        kind === 'fire' ? HOUSE_LIGHT.fire : HOUSE_LIGHT.lamp,
      );
      add(light);
      // The ceilings keep out of the fire's and the lamp's reach (H2 render
      // check: the Heart Hall's ceiling went hot orange at kid height); their
      // own warm lift stands in.
      light.excludedMeshes.push(...this.#ceilings.map((c) => c.mesh));
      this.#points.push({ kind, light });
      free -= 1;
    }
  }

  // ── Rooms ───────────────────────────────────────────────────────────

  #kit(parts: RoomParts): RoomKit {
    const scene = this.#scene;
    const floor = parts.box.floor;
    return {
      scene,
      box: parts.box,
      tier: this.#tier,
      solid: (list) => {
        for (const m of list) {
          m.computeWorldMatrix(true);
          const { minimumWorld: lo, maximumWorld: hi } = m.getBoundingInfo().boundingBox;
          this.#furniture.push({ x0: lo.x, x1: hi.x, z0: lo.z, z1: hi.z, y0: lo.y, y1: hi.y });
        }
        parts.solid.push(...list);
      },
      glow: (list) => parts.glow.push(...list),
      bed: (x, z, yaw) => {
        const own = this.#roomBeds.get(parts.box.id) ?? [];
        own.push({ x, z, yaw });
        this.#roomBeds.set(parts.box.id, own);
        const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [0.55, 0.75] : [0.75, 0.55];
        this.#furniture.push({
          x0: x - hx,
          x1: x + hx,
          z0: z - hz,
          z1: z + hz,
          y0: parts.box.y0,
          y1: parts.box.y0 + 0.6,
        });
        this.#beds.push({
          matrix: Matrix.RotationY(yaw).multiply(Matrix.Translation(x, parts.box.y0, z)),
          floor,
        });
      },
      shadow: (x, z, width, depth) => {
        this.#contact.push({
          matrix: Matrix.Scaling(width, 1, depth).multiply(
            Matrix.Translation(x, parts.box.y0 + 0.025, z),
          ),
          floor,
        });
      },
      pool: (x, z, r) => {
        this.#pools.push({
          matrix: Matrix.Scaling(r * 2, 1, r * 2).multiply(
            Matrix.Translation(x, parts.box.y0 + 0.035, z),
          ),
          floor,
        });
      },
      light: (kind, x, y, z) => this.#requests.push({ kind, at: new Vector3(x, y, z) }),
      heartSeed: (x, y, z, s) => {
        this.#seeds.push({ matrix: placeAt(x, y, z, new Vector3(s, s, s)), floor });
      },
      sign: (x, wantY, wantZ, width) => {
        // A room whose back wall is cut low (a bigger room behind it: the
        // Heart Hall behind the Snug) stands the sign on that wall's cap,
        // not in the air over it (render check, B4).
        // At kid height it hangs on the header over that opening instead
        // (render check: it hung in the open gap, on a gallery post).
        const box = parts.box;
        const cut = this.#cutBack(box);
        const y = cut ? box.y0 + HOUSE_GRID.cut + 0.08 + 0.29 : wantY;
        const z = cut ? cut.at - HOUSE_GRID.wall / 2 - 0.06 : wantZ;
        if (this.#signAt) return;
        this.#signAt = {
          x,
          y,
          z,
          width,
          room: box.id,
          kidY: cut ? box.y1 - HOUSE_KID.header / 2 : null,
        };
        const board = merged('house-sign-board', signBoard(scene, width));
        board.position.set(x, y, z);
        if (cut) {
          // Its own mesh, so it can move up to the header.
          board.material = this.#vinyl;
          board.alwaysSelectAsActiveMesh = false;
          this.#house.push(board);
          this.#signParts.push(board);
          return;
        }
        board.bakeCurrentTransformIntoVertices();
        parts.solid.push(board);
      },
    };
  }

  /**
   * One wall run: plaster inside, clapboard outside on the house's outer
   * walls, a dark cap on its top edge, skirting and a light band inside,
   * and window frames with the dusk behind the glass. Dollhouse pose: the
   * outer walls facing the camera are off and the inner ones cut low.
   */
  #wall(parts: RoomParts, run: WallRun): void {
    const scene = this.#scene;
    const { wall: thick, cut } = HOUSE_GRID;
    // The open front: off in the dollhouse, full height and faded at kid height.
    const open = run.front && run.exterior;
    // An inside wall running back to a wall cut low (a big room behind: the
    // Heart Hall behind the Snug and the Playroom) is cut low with it, or
    // its end stands up like a post in front of that room's residents
    // (render check, B4). Its upper part goes with the floor standing on it.
    // Upstairs too (round 2): the Kitchen's side wall over the Playroom's
    // roof stood in front of the Hall. A wall on the big room's outer side
    // lines up with that room's own wall, so it stays.
    const cutBack =
      run.axis === 'z' &&
      this.#runs.some((r) => {
        if (r.axis !== 'x' || !r.front || r.exterior || r.floor !== run.floor) return false;
        if (Math.abs(r.at - run.to) > 0.01 || r.from > run.at + 0.01 || r.to < run.at - 0.01)
          return false;
        const behind = this.#boxes.find((b) => b.id === r.room);
        return behind !== undefined && behind.x0 < run.at - 0.01 && behind.x1 > run.at + 0.01;
      });
    const height = (run.front && !open) || cutBack ? cut : run.height;
    const length = run.to - run.from;
    const out = run.side === 'north' || run.side === 'east' ? 1 : -1;
    const holes = [...run.doors, ...run.windows];
    const panesBefore = parts.panes.length;
    const place = (list: Mesh[], n: number): Mesh[] => {
      for (const p of list) {
        const u = p.position.x;
        const off = p.position.z + n;
        if (run.axis === 'x') p.position.set(run.from + u, p.position.y + run.y0, run.at + off * 1);
        else {
          p.rotation.y = Math.PI / 2;
          p.position.set(run.at + off, p.position.y + run.y0, run.from + u);
        }
      }
      return list;
    };
    const list = place(wallPieces(scene, length, height, thick, holes, HOUSE_PALETTE.wall), 0);
    if (run.exterior) {
      list.push(
        ...place(
          wallPieces(scene, length, height, 0.06, holes, HOUSE_PALETTE.outside),
          out * (thick / 2 + 0.03),
        ),
      );
    }
    // Its top edge, capped in dark wood where it shows: always on a cut
    // edge, and under a floor the cut can take away (slim, so it hides in
    // the skirting and clapboard of the wall standing on it).
    const capped = run.top || run.front || cutBack;
    if (capped || run.upper !== null) {
      list.push(
        ...place(
          [
            box(
              scene,
              [length + 0.04, 0.08, thick + (capped ? 0.1 : 0.06)],
              [length / 2, height + 0.04, 0],
              HOUSE_PALETTE.cap,
            ),
          ],
          0,
        ),
      );
    }
    if (height > 1.4) {
      const inside = run.exterior ? -out : 1;
      list.push(
        ...place(
          [box(scene, [length, 0.18, 0.04], [length / 2, 0.09, 0], HOUSE_PALETTE.trim)],
          inside * (thick / 2 + 0.02),
        ),
        ...place(
          [box(scene, [length, 0.4, 0.03], [length / 2, height - 0.2, 0], HOUSE_PALETTE.wallTop)],
          inside * (thick / 2 + 0.015),
        ),
      );
    }
    for (const win of run.windows) {
      if (win.y - win.h / 2 >= height) continue; // above a wall cut low
      list.push(...place(windowFrame(scene, win, thick), 0));
      const pane = CreatePlane('house-pane', { width: win.w, height: win.h }, scene);
      pane.position.set(win.u, win.y, 0);
      parts.panes.push(...place([pane], out * thick * 0.3));
    }
    if (open) {
      this.#frontWall(parts.box, run, list, parts.panes.splice(panesBefore));
      return;
    }
    // With the room behind it on its floor, or the floor above (it's there
    // because of that room, so the cut takes it away with it).
    this.#floorParts(runFloor(run, this.#boxes)).solid.push(...list);
    if (!cutBack) return;
    // The part over the cut: with the floor standing on it, and at kid
    // height in the ground-floor rooms either side (it closes the room in,
    // round 2: past it the Heart Tree's crown showed sliced by the ceiling).
    const lifted = (): Mesh[] => {
      const up = run.height - cut;
      const shifted = holes.map((h) => ({ ...h, y: h.y - cut }));
      const pieces = [
        ...wallPieces(scene, length, up, thick, shifted, HOUSE_PALETTE.wall),
        box(scene, [length, 0.4, thick + 0.03], [length / 2, up - 0.2, 0], HOUSE_PALETTE.wallTop),
      ];
      for (const p of pieces) p.position.y += cut;
      return place(pieces, 0);
    };
    if (run.upper !== null) this.#floorParts(run.upper).solid.push(...lifted());
    if (run.floor === (this.#floors[0] ?? 0)) {
      for (const id of [run.room, run.other]) {
        if (id === null) continue;
        this.#kidWalls.set(id, [...(this.#kidWalls.get(id) ?? []), ...lifted()]);
      }
    }
  }

  /**
   * An open front wall as its own see-through mesh: hidden in the dollhouse,
   * shown past `frontFrom` and faded where it stands between the camera and
   * the room, with a soft foot (it fades to nothing at the floor). Also the
   * porch in front of it, where kid height stands.
   */
  #frontWall(room: RoomBox, run: WallRun, list: Mesh[], panes: Mesh[]): void {
    const id = room.id;
    for (const p of panes) p.dispose();
    const mesh = merged(`house-${id}-wall-front`, list);
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind) ?? [];
    for (let i = 0; i < pos.length / 3; i++) {
      const t = Math.min(1, Math.max(0, ((pos[i * 3 + 1] ?? 0) - run.y0) / HOUSE_KID.softFoot));
      colors[i * 4 + 3] = t * t * (3 - 2 * t);
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    mesh.hasVertexAlpha = true;
    const material = this.#vinyl.clone(`house-${id}-wall-front`);
    material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    material.alpha = HOUSE_KID.fadedAlpha;
    mesh.material = material;
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    this.#house.push(mesh);
    this.#fronts.push({ room: id, floor: room.floor, mesh, material, wall: run });
    if (run.y0 === 0) {
      const z1 = run.at - HOUSE_GRID.frontLip;
      // Three boards past each end, so its boards and their tones run on
      // from the room's own (render check: a crease where they met, B4).
      const past = 3 * HOUSE_GRID.plank;
      const planks = floorPlanks(
        this.#scene,
        run.from - past,
        z1 - HOUSE_KID.porch,
        run.to - run.from + 2 * past,
        HOUSE_KID.porch,
        0,
      );
      // A board under the porch's boards: no lawn showing through the gaps (render check, B4).
      planks.push(
        box(
          this.#scene,
          [run.to - run.from + 2 * past, 0.02, HOUSE_KID.porch],
          [(run.from + run.to) / 2, -0.17, z1 - HOUSE_KID.porch / 2],
          HOUSE_PALETTE.planks[2],
        ),
      );
      const porch = merged(`house-${id}-porch`, planks);
      porch.material = this.#matte;
      porch.setEnabled(false);
      this.#house.push(porch);
      this.#porch.push({ room: id, mesh: porch });
    }
  }

  #floorParts(floor: number): FloorParts {
    let parts = this.#byFloor.get(floor);
    if (!parts) {
      parts = { solid: [], glow: [], floor: [], panes: [], gift: [] };
      this.#byFloor.set(floor, parts);
    }
    return parts;
  }

  /**
   * Every floor's pieces as a few meshes, one per material: the walls and
   * furniture of all its rooms, its planks, its glowing bits and its
   * window panes (B4: one mesh per floor, not per room or wall, so the top
   * level fits the low tier's draw calls with room to spare). The floor
   * cut shows or hides each floor's meshes as a whole.
   */
  #mergeFloors(): void {
    for (const [floor, parts] of [...this.#byFloor].sort((a, b) => a[0] - b[0])) {
      const f = `f${String(floor)}`;
      // With a shadow map, the little pieces (toys, mugs, jars) go in a mesh
      // of their own that casts none: the shadow pass draws only what throws
      // a shadow you'd see.
      const small = this.#shadows
        ? parts.solid.filter((m) => extent(m) < HOUSE_SHADOW.minCaster)
        : [];
      const big = parts.solid.filter((m) => !small.includes(m));
      // The gift box goes last into the little pieces (it casts no shadow
      // you'd see) or, on low, the furniture: its vertices are the mesh's
      // last, so opening it folds them away with no rebuild (#381 H2).
      const giftCount = parts.gift.reduce((n, m) => n + m.getTotalVertices(), 0);
      const giftInSmall = this.#shadows !== null;
      if (giftInSmall) small.push(...parts.gift);
      else big.push(...parts.gift);
      const planks = this.#static(`house-${f}-floor`, parts.floor, this.#matte, false);
      planks.receiveShadows = true;
      const solid = this.#static(`house-${f}-solid`, big, this.#vinyl, true);
      const meshes = [
        solid,
        planks,
        this.#static(`house-glow-${f}`, parts.glow, this.#glow, false),
      ];
      let smallMesh: Mesh | null = null;
      if (small.length > 0) {
        smallMesh = this.#static(`house-${f}-small`, small, this.#vinyl, false);
        meshes.push(smallMesh);
      }
      if (giftCount > 0) {
        const mesh = giftInSmall ? smallMesh : solid;
        if (mesh) this.#giftRange = { mesh, count: giftCount };
      }
      if (parts.panes.length > 0) {
        const panes = this.#static(
          `house-${f}-panes`,
          parts.panes,
          paneMaterial(this.#scene, this.#look.pane),
          false,
        );
        this.#paneMeshes.push(panes);
        meshes.push(panes);
      }
      if (floor > 0) for (const mesh of meshes) this.#floorMeshes.push({ mesh, floor });
    }
  }

  /** Merges parts into one static mesh of the house (culled as a whole). */
  #static(name: string, list: readonly Mesh[], material: Mesh['material'], cast: boolean): Mesh {
    if (list.length === 0) {
      const empty = new Mesh(name, this.#scene);
      empty.setEnabled(false);
      return empty;
    }
    const mesh = merged(name, [...list]);
    mesh.material = material;
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.receiveShadows = this.#shadows !== null;
    mesh.freezeWorldMatrix();
    if (cast) this.#shadows?.addShadowCaster(mesh);
    this.#house.push(mesh);
    return mesh;
  }

  /** Heart Seed keepsakes: the map's glossy, softly glowing seed, one draw call for all. */
  #buildSeeds(): void {
    if (this.#seeds.length === 0) return;
    const seed = buildHeartSeed(this.#scene);
    seed.name = 'house-heart-seeds';
    setInstances(
      seed,
      this.#seeds.map((s) => s.matrix),
    );
    this.#house.push(seed);
    this.#instanced.push({ mesh: seed, list: this.#seeds });
  }

  /** Every bed in the house: one frame mesh and one blanket mesh, thin-instanced (two draw calls). */
  #buildBeds(): void {
    if (this.#beds.length === 0) return;
    const frame = merged('house-beds', bedFrame(this.#scene, this.#tierLook.rounds));
    frame.material = this.#vinyl;
    const blanket = merged('house-blankets', bedBlanket(this.#scene));
    blanket.material = this.#vinyl;
    for (const mesh of [frame, blanket]) {
      mesh.receiveShadows = this.#shadows !== null;
      this.#shadows?.addShadowCaster(mesh);
      this.#house.push(mesh);
    }
    // Each bed keeps its blanket colour whichever floors the cut shows.
    const color = (i: number) => {
      const c = linear(HOUSE_BLANKETS[i % HOUSE_BLANKETS.length] ?? '#ffffff');
      return [c.r, c.g, c.b, 1];
    };
    this.#instanced.push(
      { mesh: frame, list: this.#beds },
      { mesh: blanket, list: this.#beds, color },
    );
  }

  /** Contact shadows under furniture (low tier: no shadow map) and warm light pools (every tier). */
  #buildDecals(low: boolean): void {
    const scene = this.#scene;
    const instance = (mesh: Mesh, list: readonly Placed[]) => {
      mesh.isPickable = false;
      this.#house.push(mesh);
      this.#instanced.push({ mesh, list });
    };
    if (low && this.#contact.length > 0) {
      const contact = createContactShadowMesh(scene);
      contact.name = 'house-contact-shadows';
      instance(contact, this.#contact);
    }
    if (this.#pools.length > 0) {
      const m = new StandardMaterial('house-pool', scene);
      m.disableLighting = true;
      m.diffuseColor = Color3.Black();
      m.emissiveColor = linear('#ffae62').scale(low ? 0.55 : 0.32); // TUNE
      m.opacityTexture = radialTexture(scene, 'house-pool', [
        [0, 1],
        [0.35, 0.55],
        [0.7, 0.18],
        [1, 0],
      ]);
      m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true;
      this.#poolMaterial = m;
      const quad = CreateGround('house-pools', { width: 1, height: 1 }, scene);
      quad.material = m;
      quad.alwaysSelectAsActiveMesh = true;
      instance(quad, this.#pools);
    }
  }

  #buildSign(text: string): void {
    const at = this.#signAt;
    if (!at) return;
    const plane = CreatePlane(
      'house-sign',
      { width: at.width - 0.1, height: (at.width - 0.1) / 4 },
      this.#scene,
    );
    plane.material = signMaterial(this.#scene, text);
    plane.position.set(at.x, at.y, at.z - 0.05);
    plane.isPickable = false;
    this.#house.push(plane);
    if (at.kidY !== null) this.#signParts.push(plane);
  }

  /** The wall cut low behind a room (a bigger room behind it: the Heart Hall behind the Snug), if any. */
  #cutBack(box: RoomBox): WallRun | undefined {
    return this.#runs.find(
      (r) =>
        r.axis === 'x' &&
        r.front &&
        !r.exterior &&
        r.other === box.id &&
        r.floor === box.floor &&
        Math.abs(r.at - box.z1) < 0.01,
    );
  }

  /**
   * What kid height sees overhead, built for every room on the ground
   * floor (kid height walks in there): the roof from inside where nothing
   * stands above, else a beamed ceiling, since the floor cut takes the
   * floor above away (B4).
   */
  #buildCeilings(rooms: readonly RoomBox[]): void {
    for (const r of rooms) {
      if (r.floor !== (this.#floors[0] ?? 0)) continue;
      const covered = rooms.some((o) => covers(o, r));
      // It reaches out over the porch, so kid height (standing out there) sees no sky above.
      const overhang = HOUSE_KID.minStandBack + 0.6;
      const [w, d] = [r.x1 - r.x0, r.z1 - r.z0];
      // Just over the walls' tops, so the joists clear the sign (render check, B4).
      const parts = covered
        ? { solid: beamCeiling(this.#scene, r.x0, r.z0, w, d, r.y1 + 0.04, overhang), glow: [] }
        : roofInside(this.#scene, r.x0, r.z0, w, d, r.y1, overhang);
      // Over a back wall cut low, a header across the opening: it frames the
      // room behind, holds the sign, and keeps that room's tall things (the
      // Heart Tree's crown) from showing sliced by the ceiling's edge.
      if (this.#cutBack(r)) {
        const h = HOUSE_KID.header;
        parts.solid.push(
          box(
            this.#scene,
            [w, h, HOUSE_GRID.wall],
            [r.x0 + w / 2, r.y1 - h / 2 + 0.04, r.z1],
            HOUSE_PALETTE.wall,
          ),
          box(
            this.#scene,
            [w + 0.04, 0.1, HOUSE_GRID.wall + 0.06],
            [r.x0 + w / 2, r.y1 - h + 0.04, r.z1],
            HOUSE_PALETTE.cap,
          ),
        );
      }
      parts.solid.push(...(this.#kidWalls.get(r.id) ?? []));
      for (const [name, list, material] of [
        [`house-${r.id}-ceiling`, parts.solid, this.#ceilingMaterial()],
        [`house-${r.id}-ceiling-glow`, parts.glow, this.#glow],
      ] as const) {
        if (list.length === 0) continue;
        const mesh = merged(name, list);
        mesh.material = material;
        mesh.alwaysSelectAsActiveMesh = false;
        mesh.setEnabled(false);
        // The sun comes in through the back windows, never through the roof:
        // it leaves the ceiling out (H2 render check: an unshadowed rafter
        // face lit up hard white by day, lavender at night).
        this.#sun?.excludedMeshes.push(mesh);
        this.#house.push(mesh);
        this.#ceilings.push({ room: r.id, mesh });
      }
    }
  }

  /**
   * The ceilings' vinyl on high and medium: lit by neither the sun nor the
   * fire and lamp (no hard rafter streak, no hot orange), with a soft warm
   * lift of its own instead. Low keeps the shared vinyl (its one house
   * light reads well, owner-approved in B4).
   */
  #ceilingMaterial(): PBRMaterial {
    if (this.#tierLook.shadowMap === 0) return this.#vinyl;
    const found = this.#scene.getMaterialByName('house-ceiling');
    if (found instanceof PBRMaterial) return found;
    const m = this.#vinyl.clone('house-ceiling');
    m.emissiveColor = linear(HOUSE_PALETTE.ceiling.lift);
    return m;
  }

  /** A gable roof over every room with nothing above it, for the entry glide to lift away. */
  #buildRoof(rooms: readonly RoomBox[], runs: readonly WallRun[]): Mesh | null {
    const parts = rooms
      .filter((r) => !rooms.some((o) => covers(o, r)))
      .flatMap((r) =>
        gableRoof(this.#scene, r.x0 - 0.2, r.z0 - 0.2, r.x1 - r.x0 + 0.4, r.z1 - r.z0 + 0.4, r.y1),
      );
    if (parts.length === 0 || runs.length === 0) return null;
    const roof = merged('house-roof', parts);
    roof.material = this.#roofMaterial;
    this.#roofMaterial.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    roof.setEnabled(false);
    this.#house.push(roof);
    return roof;
  }

  // ── Outside ─────────────────────────────────────────────────────────

  /** The clearing: a dusk lawn, a ring of soft trees, the front yard, a stone footing and the sky. */
  #buildOutside(b: HouseBounds): void {
    const scene = this.#scene;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = linear(HOUSE_PALETTE.haze);

    const lawn = CreateDisc(
      'house-lawn',
      { radius: HOUSE_OUTSIDE.lawnRadius, tessellation: 48 },
      scene,
    );
    lawn.rotation.x = Math.PI / 2;
    lawn.position.set(cx, -0.32, cz);
    const lm = new PBRMaterial('house-lawn', scene);
    lm.albedoColor = linear(HOUSE_PALETTE.lawn);
    lm.emissiveColor = linear(HOUSE_PALETTE.lawnLift);
    lm.roughness = 0.95;
    lm.metallic = 0;
    lawn.material = lm;
    this.#lawnMaterial = lm;
    lawn.isPickable = false;
    lawn.receiveShadows = this.#tierLook.shadowMap > 0;
    this.#house.push(lawn);

    const sky = skyDome(scene, HOUSE_OUTSIDE.lawnRadius * 2.2);
    sky.position.set(cx, 0, cz);
    const sm = new StandardMaterial('house-sky', scene);
    sm.disableLighting = true;
    sm.diffuseColor = Color3.Black();
    sm.emissiveColor = Color3.White();
    sm.fogEnabled = false;
    sm.backFaceCulling = false;
    sky.material = sm;
    sky.applyFog = false;
    this.#house.push(sky);
    this.#sky = sky;

    // Soft pastel trees in a ring, none on the camera's side of the house.
    const count = this.#tierLook.trees;
    const [near, far] = HOUSE_OUTSIDE.treeRing;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.35 * Math.sin(i * 2.7);
      const r = near + (far - near) * (((i * 7) % 5) / 5);
      const x = cx + Math.cos(a) * r * 1.15;
      const z = cz + Math.sin(a) * r;
      if (z < b.minZ - 2) continue; // the camera looks in from the front
      this.#trees.push({
        x,
        z,
        s: 1.2 + ((i * 3) % 4) * 0.25,
        hex: HOUSE_TREE_CROWNS[i % HOUSE_TREE_CROWNS.length] ?? '#9fcf9a',
      });
    }
    const parts = treeParts(scene, this.#tierLook.treeSegments);
    const trunks = merged('house-tree-trunks', parts.trunk);
    const crowns = merged('house-tree-crowns', parts.crown);
    for (const mesh of [trunks, crowns]) {
      mesh.material = this.#vinyl;
      mesh.alwaysSelectAsActiveMesh = true;
      this.#house.push(mesh);
    }
    this.#treeMeshes = { trunks, crowns };
    this.frameOutside(null);
    const yard = frontYard(scene, b.minX, b.maxX, b.minZ, this.#tierLook.rounds);
    // A warm pool on the lawn under each lantern.
    for (const [x, z] of yard.lanterns) {
      this.#pools.push({
        matrix: Matrix.Scaling(2, 1, 2).multiply(Matrix.Translation(x, -0.28, z)),
        floor: 0,
      });
    }
    const footing = box(
      scene,
      [b.maxX - b.minX + 0.6, 0.3, b.maxZ - b.minZ + 0.6],
      [cx, -0.17, cz],
      HOUSE_PALETTE.footing,
    );
    this.#static('house-outside', [...yard.solid, footing], this.#vinyl, false);
    this.#static('house-outside-glow', yard.glow, this.#glow, false);
  }

  // ── The cast ────────────────────────────────────────────────────────

  /**
   * Residents in their rooms at the spots the room's builder gave (one
   * that's away isn't drawn), and the Keeper by the first fire, turned to
   * within a little of the camera, which looks in from the front.
   */
  #placeCast(
    view: HouseView,
    plans: ReadonlyMap<string, RoomPlan>,
    options: HouseSceneOptions,
  ): void {
    const b = this.bounds;
    const camera = { x: (b.minX + b.maxX) / 2, z: b.minZ - 12 };
    const facing = (spot: FloorSpot, i: number) => {
      const turn = HOUSE_CAST.faceTurn * Math.sin(i * 2.1);
      return faceYaw(camera.x - spot.x, camera.z - spot.z) + turn;
    };
    let n = 0;
    const order: string[] = [];
    const keeperRoom = view.rooms.find((r) => plans.get(r.id)?.keeper) ?? view.rooms[0];
    if (keeperRoom) {
      const k = roomBox(keeperRoom);
      this.#focus = {
        id: keeperRoom.id,
        room: { minX: k.x0, maxX: k.x1, minY: k.y0, maxY: k.y1, minZ: k.z0, maxZ: k.z1 },
        point: new Vector3((k.x0 + k.x1) / 2, k.y0 + HOUSE_KID.eyeHeight, (k.z0 + k.z1) / 2),
      };
    }
    // Low tier: the residents nearest the kid-height camera in that room
    // (`HOUSE_CAST.lowHeroes`) are the ones big on screen, so they alone are
    // drawn smooth (owner check #4), from `frontFrom` on (see setPose).
    const heroes = new Set<string>();
    if (this.#tier === 'low' && keeperRoom) {
      const plan = plans.get(keeperRoom.id);
      keeperRoom.residents
        .filter((r) => r.away === null)
        .map((r, i) => ({ id: r.squishyId, z: plan?.residents[i]?.z ?? Infinity }))
        .filter((r) => options.cast.has(r.id))
        .sort((a, b) => a.z - b.z)
        .slice(0, HOUSE_CAST.lowHeroes)
        .forEach((r) => heroes.add(r.id));
      if (heroes.size > 0) {
        this.#hero = new SquishyField(this.#scene, {
          registry: options.registry,
          lod: this.#squishies.lod,
          breathing: false,
        });
      }
    }
    for (const room of view.rooms) {
      const plan = plans.get(room.id);
      const box = roomBox(room);
      const present = room.residents.filter((r) => r.away === null);
      present.forEach((resident, i) => {
        const member = options.cast.get(resident.squishyId);
        const spot = plan?.residents[i] ?? { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 };
        if (!member) return;
        const field = heroes.has(resident.squishyId) && this.#hero ? this.#hero : this.#squishies;
        const placement: SquishyPlacement = {
          x: spot.x,
          z: spot.z,
          y: box.y0,
          yaw: facing(spot, n),
          scale: HOUSE_CAST.squishyScale,
        };
        this.#cast.push(
          this.#castSpot(
            room.id,
            () => {
              const handle = field.add(member.species, resident.squishyId, placement);
              field.setAccessory(handle, accessoryItem(member.accessory));
              this.#handles.set(resident.squishyId, { field, handle });
              this.#residentAt.set(resident.squishyId, placement);
              return () => {
                field.remove(handle);
                this.#handles.delete(resident.squishyId);
              };
            },
            'resident',
            { x: spot.x, y: box.y0, z: spot.z },
          ),
        );
        order.push(resident.squishyId);
        n += 1;
      });
    }
    // The Keeper's room first: its residents are the ones big on screen.
    const first = new Set(keeperRoom?.residents.map((r) => r.squishyId) ?? []);
    this.#order = [...order.filter((id) => first.has(id)), ...order.filter((id) => !first.has(id))];
    if (!keeperRoom) return;
    const box = roomBox(keeperRoom);
    const spot = plans.get(keeperRoom.id)?.keeper ?? { x: (box.x0 + box.x1) / 2, z: box.z0 + 0.8 };
    const base = KEEPER_DATA.bases[0];
    const config = options.keeper ?? (base ? defaultKeeperConfig(base) : null);
    if (!config) return;
    const placement: KeeperPlacement = {
      x: spot.x,
      z: spot.z,
      y: box.y0,
      yaw: facing(spot, 0),
      scale: HOUSE_CAST.keeperScale,
      lean: HOUSE_CAST.keeperLean,
    };
    const items = keeperItems(options.keeperWearing ?? []);
    this.#keeperBase = placement;
    this.#walkAt = { x: spot.x, z: spot.z, y: box.y0 };
    this.#walkYaw = placement.yaw ?? 0;
    this.#cast.push(
      this.#castSpot(
        keeperRoom.id,
        () => {
          const handle: KeeperHandle = this.#keepers.add(
            config,
            this.#keeperPlace() ?? placement,
            items,
          );
          this.#keeperHandle = handle;
          return () => {
            this.#keepers.remove(handle);
            this.#keeperHandle = null;
          };
        },
        'keeper',
        { x: spot.x, y: box.y0, z: spot.z },
      ),
    );
  }

  /** One of the cast, drawn while the floor cut shows its room's floor. */
  #castSpot(
    room: string,
    add: () => () => void,
    kind: CastSpot['kind'],
    at: CastSpot['at'],
  ): CastSpot {
    let remove: (() => void) | null = null;
    return {
      room,
      at,
      kind,
      add: () => {
        remove ??= add();
      },
      remove: () => {
        remove?.();
        remove = null;
      },
      drawn: () => remove !== null,
    };
  }

  /** Residents drawn now (the floor cut leaves out the ones on other floors). */
  #drawnResidents(): number {
    return this.#cast.filter((c) => c.kind === 'resident' && c.drawn()).length;
  }
}
