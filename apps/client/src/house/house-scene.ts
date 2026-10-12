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
import { SquishyField } from '../procedural/squishy-field.js';
import { frontAlpha, project, wallFade, type FadeWall, type HousePose } from './house-camera.js';
import {
  HOUSE_BLANKETS,
  HOUSE_CAST,
  HOUSE_GLIDE,
  HOUSE_GRID,
  HOUSE_KID,
  HOUSE_LIGHT,
  HOUSE_OUTSIDE,
  HOUSE_PALETTE,
  HOUSE_TIERS,
  HOUSE_TREE_CROWNS,
} from './house-config.js';
import {
  houseBounds,
  roomBox,
  wallRuns,
  type HouseBounds,
  type RoomBox,
  type WallRun,
} from './house-layout.js';
import {
  bedBlanket,
  bedFrame,
  box,
  floorPlanks,
  frontYard,
  gableRoof,
  roofInside,
  TREE_TOP,
  treeParts,
  signBoard,
  skyDome,
  wallPieces,
  windowFrame,
} from './house-models.js';
import { roomBuilder, type FloorSpot, type RoomKit, type RoomPlan } from './house-rooms.js';
import { duskPaneMaterial, radialTexture, signMaterial } from './house-textures.js';

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

interface RoomParts {
  readonly box: RoomBox;
  readonly solid: Mesh[];
  readonly glow: Mesh[];
  readonly floor: Mesh[];
  readonly panes: Mesh[];
  readonly walls: Map<string, Mesh[]>;
}

export class HouseScene {
  readonly content: SceneContent;
  readonly bounds: HouseBounds;
  readonly #scene: Scene;
  readonly #tier: QualityTier;
  readonly #look: (typeof HOUSE_TIERS)[QualityTier];
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
  #roofLift = 1;
  #residents = 0;
  readonly #beds: Matrix[] = [];
  readonly #contact: Matrix[] = [];
  readonly #pools: Matrix[] = [];
  readonly #requests: { kind: 'fire' | 'lamp'; at: Vector3 }[] = [];
  readonly #seeds: Matrix[] = [];
  #signAt: { x: number; y: number; z: number; width: number } | null = null;
  readonly #instrumentation: SceneInstrumentation;
  readonly #rooms: number;
  readonly #lookAt = new Vector3();
  /** Front walls (off in the dollhouse, faded at kid height) and the porch you stand on. */
  readonly #fronts: { room: string; mesh: Mesh; material: PBRMaterial; wall: FadeWall }[] = [];
  readonly #porch: { room: string; mesh: Mesh }[] = [];
  /** The roof seen from inside, at kid height only (the focus room's alone). */
  readonly #ceilings: { room: string; mesh: Mesh }[] = [];
  #frontAlpha: number | null = null;
  /** The room kid height walks into (the Keeper's room), its floor's middle at eye level. */
  #focus: { id: string; room: HouseBounds; point: Vector3 } | null = null;
  /** Low tier: the nearest residents at kid height drawn smooth (owner check #4), their own field. */
  #hero: SquishyField | null = null;
  #meshCount = 0;
  readonly #trees: { x: number; z: number; s: number; hex: string }[] = [];
  #treeMeshes: { trunks: Mesh; crowns: Mesh } | null = null;

  constructor(scene: Scene, view: HouseView, options: HouseSceneOptions) {
    this.#scene = scene;
    this.#tier = options.tier;
    this.#look = HOUSE_TIERS[options.tier];
    const low = this.#look.shadowMap === 0;
    scene.clearColor = Color4.FromColor3(linear(HOUSE_PALETTE.sky), 1);

    // One matte vinyl for every painted prop (art bible §4: matte-er than squishies).
    this.#vinyl = new PBRMaterial('house-vinyl', scene);
    this.#vinyl.albedoColor = Color3.White();
    this.#vinyl.metallic = 0;
    this.#vinyl.roughness = 0.6; // TUNE
    this.#vinyl.clearCoat.isEnabled = this.#look.clearCoat;
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
    this.#fill.specular = this.#look.specular
      ? linear(HOUSE_LIGHT.fill.color).scale(HOUSE_LIGHT.fill.specular)
      : Color3.Black();
    this.#fill.intensity = this.#look.fill;
    this.#fill.includedOnlyMeshes = [];
    // The fields make their meshes as they first draw (in beforeRender):
    // sort any new ones before the camera renders, every frame the mesh
    // count changes.
    scene.onBeforeCameraRenderObservable.add(() => {
      if (scene.meshes.length !== this.#meshCount) this.#sortCast();
    });

    this.#setUpWarmLights(low);
    if (!low) {
      const sun = this.#warm.find((l): l is DirectionalLight => l instanceof DirectionalLight);
      if (sun) this.#shadows = this.#shadowsFor(sun);
    }

    const rooms = view.rooms.map((r) => roomBox(r));
    this.#rooms = rooms.length;
    this.bounds = houseBounds(rooms);
    const runs = wallRuns(view.rooms);
    this.#buildOutside(this.bounds);
    const plans = new Map<string, RoomPlan>();
    for (const box of rooms) {
      const parts: RoomParts = { box, solid: [], glow: [], floor: [], panes: [], walls: new Map() };
      const frontOpen = runs.some((r) => r.room === box.id && r.front && r.exterior);
      const z0 = frontOpen ? box.z0 - HOUSE_GRID.frontLip : box.z0;
      parts.floor.push(...floorPlanks(scene, box.x0, z0, box.x1 - box.x0, box.z1 - z0, box.y0));
      if (box.y0 > 0) parts.floor.push(underside(scene, box, z0));
      for (const run of runs.filter((r) => r.room === box.id)) this.#wall(parts, run);
      plans.set(box.id, roomBuilder(box.look)(this.#kit(parts)));
      this.#mergeRoom(parts);
    }
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
      if (!focus || (other && (fade >= 1 || this.#tier === 'low'))) {
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
    for (const c of this.#ceilings) c.mesh.setEnabled(c.room === focus?.id);
    this.#frontAlpha = least;
  }

  /** The room kid height walks into, as a box (the camera takes only that). */
  get focusRoom(): HouseBounds | null {
    return this.#focus?.room ?? null;
  }

  /** Squishy and Keeper meshes take the neutral fill and none of the warm lights. */
  #sortCast(): void {
    const scene = this.#scene;
    this.#meshCount = scene.meshes.length;
    const fill = this.#fill.includedOnlyMeshes;
    for (const mesh of scene.meshes) {
      if (!CAST.test(mesh.name) || fill.includes(mesh)) continue;
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
      residents: this.#residents,
      keeper: this.#keepers.handles.length > 0,
      lights: this.#scene.lights.filter((l) => l.isEnabled()).length,
      shadowMap: this.#shadows !== null,
      drawCalls: this.#instrumentation.drawCallsCounter.current,
      triangles: activeTriangles(this.#scene),
      pitch: Math.round(pitch * 10) / 10,
      roof: this.#roofLift,
      frontWallAlpha: this.#frontAlpha,
      heroes: this.#hero?.lod === 'high' ? this.#hero.handles.length : 0,
    };
  }

  /**
   * Which residents' faces the camera sees (house-shots, the dev hook): a
   * face counts when it's inside the frame and nothing of the house stands
   * between it and the camera.
   */
  faceReport(): { visible: number; total: number } {
    const scene = this.#scene;
    const camera = scene.activeCamera;
    const fields = [this.#squishies, ...(this.#hero ? [this.#hero] : [])];
    const handles = fields.flatMap((f) => f.handles.map((h) => ({ f, h })));
    if (!camera) return { visible: 0, total: handles.length };
    const engine = scene.getEngine();
    const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const eye = camera.globalPosition;
    const solid = new Set<AbstractMesh>(
      this.#house.filter((m) => !/(sky|lawn|pools|contact|sign|panes|wall-front)/.test(m.name)),
    );
    let visible = 0;
    for (const { f, h } of handles) {
      const centre = f.centre(h);
      if (!centre) continue;
      const toEye = eye.subtract(centre).normalize();
      const face = centre.add(toEye.scale(0.3 * HOUSE_CAST.squishyScale));
      const p = Vector3.Project(face, Matrix.Identity(), scene.getTransformMatrix(), vp);
      const fx = p.x / vp.width;
      const fy = p.y / vp.height;
      if (p.z <= 0 || p.z >= 1 || fx < 0.02 || fx > 0.98 || fy < 0.02 || fy > 0.98) continue;
      const dir = face.subtract(eye);
      const length = dir.length();
      const hit = scene.pickWithRay(
        new Ray(eye, dir.normalize(), length - 0.05),
        (m) => solid.has(m) && m.isEnabled(),
      );
      if (!hit?.hit) visible += 1;
    }
    return { visible, total: handles.length };
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
  }

  #shadowsFor(sun: DirectionalLight): ShadowGenerator {
    const sg = new ShadowGenerator(this.#look.shadowMap, sun);
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
    const b = this.bounds;
    const cast = this.#fill.includedOnlyMeshes;
    const add = (light: Light) => {
      light.excludedMeshes = [...cast];
      this.#warm.push(light);
    };
    const point = (name: string, at: Vector3, look: { intensity: number; color: string }) => {
      const light = new PointLight(name, at, scene);
      light.diffuse = linear(look.color);
      light.specular = this.#look.specular ? linear(look.color).scale(0.5) : Color3.Black();
      light.intensity = look.intensity;
      light.range = HOUSE_LIGHT.range;
      return light;
    };
    if (low) {
      // One warm light over the rooms stands in for the fire, the lamps and the window.
      add(
        point(
          'house-light',
          new Vector3((b.minX + b.maxX) / 2, b.maxY + 0.9, (b.minZ + b.maxZ) / 2 - 1.8),
          HOUSE_LIGHT.house,
        ),
      );
      return;
    }
    let free = this.#look.lights - 1 - this.#warm.length; // the fill and the sun so far
    for (const kind of ['fire', 'lamp'] as const) {
      const wanted = this.#requests.find((r) => r.kind === kind);
      if (!wanted || free <= 0) continue;
      add(point(`house-${kind}`, wanted.at, kind === 'fire' ? HOUSE_LIGHT.fire : HOUSE_LIGHT.lamp));
      free -= 1;
    }
  }

  // ── Rooms ───────────────────────────────────────────────────────────

  #kit(parts: RoomParts): RoomKit {
    const scene = this.#scene;
    return {
      scene,
      box: parts.box,
      solid: (list) => parts.solid.push(...list),
      glow: (list) => parts.glow.push(...list),
      bed: (x, z, yaw) => {
        this.#beds.push(Matrix.RotationY(yaw).multiply(Matrix.Translation(x, parts.box.y0, z)));
      },
      shadow: (x, z, width, depth) => {
        this.#contact.push(
          Matrix.Scaling(width, 1, depth).multiply(Matrix.Translation(x, parts.box.y0 + 0.025, z)),
        );
      },
      pool: (x, z, r) => {
        this.#pools.push(
          Matrix.Scaling(r * 2, 1, r * 2).multiply(Matrix.Translation(x, parts.box.y0 + 0.035, z)),
        );
      },
      light: (kind, x, y, z) => this.#requests.push({ kind, at: new Vector3(x, y, z) }),
      heartSeed: (x, y, z, s) => {
        this.#seeds.push(placeAt(x, y, z, new Vector3(s, s, s)));
      },
      sign: (x, y, z, width) => {
        this.#signAt ??= { x, y, z, width };
        const board = merged('house-sign-board', signBoard(scene, width));
        board.position.set(x, y, z);
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
    const height = run.front && !open ? cut : run.height;
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
    if (run.top || run.front) {
      list.push(
        ...place(
          [
            box(
              scene,
              [length + 0.04, 0.08, thick + 0.1],
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
      list.push(...place(windowFrame(scene, win, thick), 0));
      const pane = CreatePlane('house-pane', { width: win.w, height: win.h }, scene);
      pane.position.set(win.u, win.y, 0);
      parts.panes.push(...place([pane], out * thick * 0.3));
    }
    if (open) {
      this.#frontWall(parts.box.id, run, list, parts.panes.splice(panesBefore));
      return;
    }
    const key = run.side;
    parts.walls.set(key, [...(parts.walls.get(key) ?? []), ...list]);
  }

  /**
   * An open front wall as its own see-through mesh: hidden in the dollhouse,
   * shown past `frontFrom` and faded where it stands between the camera and
   * the room, with a soft foot (it fades to nothing at the floor). Also the
   * porch in front of it, where kid height stands.
   */
  #frontWall(id: string, run: WallRun, list: Mesh[], panes: Mesh[]): void {
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
    this.#fronts.push({ room: id, mesh, material, wall: run });
    if (run.y0 === 0) {
      const z1 = run.at - HOUSE_GRID.frontLip;
      const planks = floorPlanks(
        this.#scene,
        run.from - 0.6,
        z1 - HOUSE_KID.porch,
        run.to - run.from + 1.2,
        HOUSE_KID.porch,
        0,
      );
      const porch = merged(`house-${id}-porch`, planks);
      porch.material = this.#matte;
      porch.setEnabled(false);
      this.#house.push(porch);
      this.#porch.push({ room: id, mesh: porch });
    }
  }

  /** A room's pieces as a few meshes: walls by side (they fade one by one at kid height), then one per material. */
  #mergeRoom(parts: RoomParts): void {
    const id = parts.box.id;
    for (const [side, list] of parts.walls)
      this.#static(`house-${id}-wall-${side}`, list, this.#vinyl, true);
    this.#static(`house-${id}-floor`, parts.floor, this.#matte, false).receiveShadows = true;
    this.#static(`house-${id}-solid`, parts.solid, this.#vinyl, true);
    this.#static(`house-${id}-glow`, parts.glow, this.#glow, false);
    if (parts.panes.length > 0)
      this.#static(`house-${id}-panes`, parts.panes, duskPaneMaterial(this.#scene), false);
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
    setInstances(seed, this.#seeds);
    this.#house.push(seed);
  }

  /** Every bed in the house: one frame mesh and one blanket mesh, thin-instanced (two draw calls). */
  #buildBeds(): void {
    if (this.#beds.length === 0) return;
    const frame = merged('house-beds', bedFrame(this.#scene));
    frame.material = this.#vinyl;
    const blanket = merged('house-blankets', bedBlanket(this.#scene));
    blanket.material = this.#vinyl;
    const data = new Float32Array(this.#beds.length * 16);
    this.#beds.forEach((m, i) => {
      m.copyToArray(data, i * 16);
    });
    const colors = new Float32Array(this.#beds.length * 4);
    this.#beds.forEach((_, i) => {
      const c = linear(HOUSE_BLANKETS[i % HOUSE_BLANKETS.length] ?? '#ffffff');
      colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    for (const mesh of [frame, blanket]) {
      mesh.thinInstanceSetBuffer('matrix', data.slice(), 16, true);
      mesh.receiveShadows = this.#shadows !== null;
      this.#shadows?.addShadowCaster(mesh);
      this.#house.push(mesh);
    }
    blanket.thinInstanceSetBuffer('color', colors, 4, true);
  }

  /** Contact shadows under furniture (low tier: no shadow map) and warm light pools (every tier). */
  #buildDecals(low: boolean): void {
    const scene = this.#scene;
    const instance = (mesh: Mesh, list: readonly Matrix[]) => {
      const data = new Float32Array(list.length * 16);
      list.forEach((m, i) => {
        m.copyToArray(data, i * 16);
      });
      mesh.thinInstanceSetBuffer('matrix', data, 16, true);
      mesh.isPickable = false;
      this.#house.push(mesh);
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
  }

  /** The roof seen from inside over every room with nothing above it (kid height only). */
  #buildCeilings(rooms: readonly RoomBox[]): void {
    for (const r of rooms) {
      if (
        rooms.some(
          (o) =>
            o !== r && o.y0 >= r.y1 && o.x0 < r.x1 && o.x1 > r.x0 && o.z0 < r.z1 && o.z1 > r.z0,
        )
      )
        continue;
      // It reaches out over the porch, so kid height (standing out there) sees no sky above.
      const parts = roofInside(
        this.#scene,
        r.x0,
        r.z0,
        r.x1 - r.x0,
        r.z1 - r.z0,
        r.y1,
        HOUSE_KID.minStandBack + 0.6,
      );
      for (const [name, list, material] of [
        [`house-${r.id}-ceiling`, parts.solid, this.#vinyl],
        [`house-${r.id}-ceiling-glow`, parts.glow, this.#glow],
      ] as const) {
        const mesh = merged(name, list);
        mesh.material = material;
        mesh.alwaysSelectAsActiveMesh = false;
        mesh.setEnabled(false);
        this.#house.push(mesh);
        this.#ceilings.push({ room: r.id, mesh });
      }
    }
  }

  /** A gable roof over every room with nothing above it, for the entry glide to lift away. */
  #buildRoof(rooms: readonly RoomBox[], runs: readonly WallRun[]): Mesh | null {
    const parts = rooms
      .filter(
        (r) =>
          !rooms.some(
            (o) =>
              o !== r && o.y0 >= r.y1 && o.x0 < r.x1 && o.x1 > r.x0 && o.z0 < r.z1 && o.z1 > r.z0,
          ),
      )
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
    lawn.isPickable = false;
    lawn.receiveShadows = this.#look.shadowMap > 0;
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

    // Soft pastel trees in a ring, none on the camera's side of the house.
    const count = this.#look.trees;
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
    const parts = treeParts(scene, this.#look.shadowMap > 0 ? 9 : 7);
    const trunks = merged('house-tree-trunks', parts.trunk);
    const crowns = merged('house-tree-crowns', parts.crown);
    for (const mesh of [trunks, crowns]) {
      mesh.material = this.#vinyl;
      mesh.alwaysSelectAsActiveMesh = true;
      this.#house.push(mesh);
    }
    this.#treeMeshes = { trunks, crowns };
    this.frameOutside(null);
    const yard = frontYard(scene, b.minX, b.maxX, b.minZ);
    // A warm pool on the lawn under each lantern.
    for (const [x, z] of yard.lanterns) {
      this.#pools.push(Matrix.Scaling(2, 1, 2).multiply(Matrix.Translation(x, -0.28, z)));
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
        const handle = field.add(member.species, resident.squishyId, {
          x: spot.x,
          z: spot.z,
          y: box.y0,
          yaw: facing(spot, n),
          scale: HOUSE_CAST.squishyScale,
        });
        field.setAccessory(handle, accessoryItem(member.accessory));
        n += 1;
      });
    }
    this.#residents = n;
    if (!keeperRoom) return;
    const box = roomBox(keeperRoom);
    const spot = plans.get(keeperRoom.id)?.keeper ?? { x: (box.x0 + box.x1) / 2, z: box.z0 + 0.8 };
    const base = KEEPER_DATA.bases[0];
    const config = options.keeper ?? (base ? defaultKeeperConfig(base) : null);
    if (!config) return;
    this.#keepers.add(
      config,
      {
        x: spot.x,
        z: spot.z,
        y: box.y0,
        yaw: facing(spot, 0),
        scale: HOUSE_CAST.keeperScale,
        lean: HOUSE_CAST.keeperLean,
      },
      keeperItems(options.keeperWearing ?? []),
    );
  }
}
