import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  defaultKeeperConfig,
  GAME_DATA,
  OPENING_CINEMATIC,
  KEEPER_DATA,
  visualRegistry,
  type CinematicActor,
  type KeeperConfig,
  type Species,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { buildHeartSeed } from '../map/map-scene.js';
import type { SquishyLod } from '../procedural/config.js';
import { HollowMan } from '../procedural/hollow-man/hollow-man.js';
import { BuildingField, type BuildingPlacement } from '../procedural/buildings/building-field.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import type { KeeperItem } from '../procedural/keeper/keeper-items.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { ACTOR_SIZE, DRAIN, NIGHT_LIGHT, SEED_GLOW, SKY } from './cinematic-config.js';
import { CinematicWorld } from './cinematic-world.js';
import { ClaimLayer } from './claim-layer.js';
import { SeedShards } from './seed-shards.js';
import { StoryEffects } from './story-effects.js';
import {
  actorAt,
  createTimeline,
  cameraAt,
  moodAt,
  movesBetween,
  shakeAt,
  shotAt,
  type ActorPose,
  type CameraPose,
  type Mood,
  type Timeline,
} from './timeline.js';

// The opening cinematic's scene (#46, tech spec §6): one scene on the shared
// stage (one engine, scenes swapped), built once with every shot's actors so
// nothing loads mid-story. Each frame `apply(t)` poses the camera, the
// actors and the mood from the timeline, all pure functions of time. Actors
// are the game's own procedural squishies, Keepers, Hearthfires, Heart Seeds
// and the Hollow Man (CLAUDE.md "art is procedural"); the colour drain is the
// stage's in-material image processing (saturation and vignette uniforms).

/**
 * The opening cinematic's timeline. Lives in this lazily loaded module so
 * the script and the scene code only download when the cinematic plays.
 */
export function openingTimeline(): Timeline {
  return createTimeline(OPENING_CINEMATIC);
}

export interface CinematicSceneOptions {
  readonly timeline: Timeline;
  /** The player's own Keeper (shot 7), and what they wear. Null: a default Keeper. */
  readonly keeper: KeeperConfig | null;
  readonly keeperItems: readonly KeeperItem[];
  readonly reducedMotion: boolean;
  readonly lod: SquishyLod;
}

/** Read-only numbers for the dev hook (Playwright asserts on these, not pixels). */
export interface CinematicSceneStats {
  readonly shot: string;
  readonly squishies: number;
  readonly shadowSquishies: number;
  readonly keepers: number;
  /** The player's own Keeper is on screen. */
  readonly playerKeeper: boolean;
  readonly hollowMan: boolean;
  readonly seeds: number;
  readonly shards: boolean;
  readonly litFires: number;
  readonly drain: number;
  readonly tiles: number;
  /** "Your part": claimed tiles in colour, Heart Charms, hearts and joy lights on screen. */
  readonly claimed: number;
  readonly charms: number;
  readonly hearts: number;
  readonly joy: number;
  /** How far the Hollow Man reaches (0–1), and his eyes' flare (0 for reduced motion). */
  readonly reach: number;
  readonly flare: number;
  /** The camera's shake right now, world units (0 for reduced motion). */
  readonly shake: number;
}

type Entry =
  | {
      readonly kind: 'squishy';
      readonly actor: CinematicActor;
      readonly species: Species;
      handle: SquishyHandle | null;
      last: string;
    }
  | {
      readonly kind: 'keeper';
      readonly actor: CinematicActor;
      readonly config: KeeperConfig;
      readonly items: readonly KeeperItem[];
      readonly mine: boolean;
      handle: KeeperHandle | null;
      last: string;
    }
  | { readonly kind: 'seed'; readonly actor: CinematicActor; readonly mesh: Mesh }
  | { readonly kind: 'other'; readonly actor: CinematicActor };

const key = (shot: number, actor: string) => `${String(shot)}/${actor}`;
const poseKey = (p: ActorPose, y: number) =>
  `${p.x.toFixed(3)},${y.toFixed(3)},${p.z.toFixed(3)},${p.scale.toFixed(3)},${p.yaw.toFixed(3)}`;

/** Where the Hollow Man waits, hidden, when no shot has him. */
const ORIGIN = { x: 0, y: 0, z: 0 } as const;

/** The Heart Seed's own pink (map-scene's `buildHeartSeed`), which its glow scales. */
const SEED_PINK = Color3.FromHexString('#ff8fb8').toLinearSpace();

export class CinematicScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #options: CinematicSceneOptions;
  readonly #world: CinematicWorld;
  readonly #squishies: SquishyField;
  readonly #keepers: KeeperField;
  readonly #buildings: BuildingField;
  readonly #hollow: HollowMan;
  readonly #shards: SeedShards;
  readonly #effects: StoryEffects;
  readonly #claims: ClaimLayer;
  readonly #entries = new Map<string, Entry>();
  readonly #sun: DirectionalLight | null;
  readonly #base: { sun: number; environment: number };
  readonly #daySky = Color3.FromHexString(SKY.day);
  readonly #nightSky = Color3.FromHexString(SKY.night);
  readonly #lookAt = new Vector3();
  readonly #sky = new Color3();
  readonly #clear = new Color4(0, 0, 0, 1);
  #camera: CameraPose;
  #shot = 0;
  #mood: Mood = { drain: 0, night: 0, glow: 1 };
  #fires = '';
  #t = -1;
  #counts = { squishies: 0, shadow: 0, keepers: 0, mine: false, hollow: false, seeds: 0 };
  #shardsOn = false;
  #litFires = 0;
  #reach = { reach: 0, flare: 0 };
  #shake = 0;

  constructor(scene: Scene, options: CinematicSceneOptions) {
    this.#scene = scene;
    this.#options = options;
    const { cinematic } = options.timeline;
    this.#world = new CinematicWorld(scene, cinematic.world);
    this.#squishies = new SquishyField(scene, {
      registry: visualRegistry(GAME_DATA),
      lod: options.lod,
      breathing: !options.reducedMotion,
    });
    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    this.#buildings = new BuildingField(scene);
    // Heart Seeds and their shards, claimed land, hearts, joy and the Hollow
    // Man's eyes keep their colour through the drain: the story's hope (and
    // his glare). Same tone mapping as the stage, no curves or vignette.
    const hope = new ImageProcessingConfiguration();
    this.#hollow = new HollowMan(scene, { eyeImageProcessing: hope });
    this.#shards = new SeedShards(scene, hope);
    const most = (kind: CinematicActor['kind']) =>
      Math.max(0, ...cinematic.shots.map((s) => s.actors.filter((a) => a.kind === kind).length));
    this.#effects = new StoryEffects(scene, hope, {
      charms: most('heart-charm'),
      puffs: most('hearts'),
      joy: most('joy'),
    });
    this.#claims = new ClaimLayer(scene, cinematic, this.#world, hope);

    const species = new Map(GAME_DATA.species.map((s) => [s.id, s]));
    const firstBase = KEEPER_DATA.bases[0];
    if (!firstBase) throw new Error('no Keeper bases');
    cinematic.shots.forEach((shot, i) => {
      for (const actor of shot.actors) {
        const id = key(i, actor.id);
        switch (actor.kind) {
          case 'squishy': {
            const s = species.get(actor.species ?? '');
            if (s)
              this.#entries.set(id, { kind: 'squishy', actor, species: s, handle: null, last: '' });
            break;
          }
          case 'keeper':
          case 'player-keeper': {
            const mine = actor.kind === 'player-keeper';
            const base = KEEPER_DATA.bases.find((b) => b.id === actor.keeperBase) ?? firstBase;
            const config = mine
              ? (options.keeper ?? defaultKeeperConfig(firstBase))
              : defaultKeeperConfig(base);
            this.#entries.set(id, {
              kind: 'keeper',
              actor,
              config,
              items: mine ? options.keeperItems : [],
              mine,
              handle: null,
              last: '',
            });
            break;
          }
          case 'heart-seed': {
            const mesh = buildHeartSeed(scene);
            if (mesh.material instanceof PBRMaterial)
              mesh.material.imageProcessingConfiguration = hope;
            mesh.setEnabled(false);
            this.#entries.set(id, { kind: 'seed', actor, mesh });
            break;
          }
          default:
            this.#entries.set(id, { kind: 'other', actor });
        }
      }
    });
    this.#warmUp();

    // Night dims the stage's own sun and sky light (set up before this builder runs).
    this.#sun =
      scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight) ?? null;
    this.#base = { sun: this.#sun?.intensity ?? 1, environment: scene.environmentIntensity };

    // The drain's uniforms, on from the start (neutral), so they never recompile mid-shot.
    const ip = scene.imageProcessingConfiguration;
    ip.colorCurvesEnabled = true;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 0;
    ip.vignetteStretch = 0.4;
    const [vr, vg, vb] = DRAIN.vignetteColor;
    ip.vignetteColor = new Color4(vr, vg, vb, 0);

    this.#camera = cameraAt(shotAt(options.timeline, 0).shot, 0, options.reducedMotion);
    // The stage's map camera gets no input here (the player's overlay covers
    // the canvas), so its pose stays wherever this puts it, just before each
    // render. Registered after the stage's own camera observer, so this wins.
    queueMicrotask(() => {
      // The stage sets its tone mapping after this builder returns.
      const ip = scene.imageProcessingConfiguration;
      hope.toneMappingEnabled = ip.toneMappingEnabled;
      hope.toneMappingType = ip.toneMappingType;
      hope.exposure = ip.exposure;
      hope.contrast = ip.contrast;
      scene.onBeforeRenderObservable.add(() => {
        const camera = scene.activeCamera;
        if (!(camera instanceof TargetCamera)) return;
        const { position, target, fov } = this.#camera;
        camera.fov = fov;
        camera.minZ = 0.1;
        camera.maxZ = 400;
        camera.position.set(position[0], position[1], position[2]);
        camera.setTarget(this.#lookAt.set(target[0], target[1], target[2]));
      });
    });

    this.content = {
      bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
      start: { x: 0, z: 0 },
    };
  }

  /**
   * Builds every squishy and Keeper shape once, then puts them away, so a
   * new species never builds its meshes in the middle of a shot.
   */
  #warmUp(): void {
    const seen = new Set<string>();
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'squishy' && !seen.has(entry.species.id)) {
        seen.add(entry.species.id);
        this.#squishies.remove(
          this.#squishies.add(entry.species, entry.actor.id, { x: 0, z: 0, y: -50, scale: 0.001 }),
        );
      }
    }
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'keeper') {
        this.#keepers.remove(
          this.#keepers.add(entry.config, { x: 0, z: 0, y: -50, scale: 0.001 }, entry.items),
        );
      }
    }
    this.#squishies.flush();
    this.#keepers.flush();
  }

  /** Poses everything for time `t` (seconds); `now` is wall-clock ms for squish moves. */
  apply(t: number, now: number): void {
    const { timeline, reducedMotion } = this.#options;
    const { index, shot, local } = shotAt(timeline, t);
    // Moves fire as time passes; a seek (backwards or a big jump) fires none.
    if (t > this.#t && t - this.#t < 0.5) {
      for (const m of movesBetween(timeline, this.#t, t))
        this.#play(key(m.shot, m.actor), m.move, now);
    }
    this.#t = t;
    this.#shot = index;
    const camera = cameraAt(shot, local, reducedMotion);
    const [sx, sy, sz] = shakeAt(shot, local, reducedMotion);
    this.#shake = Math.hypot(sx, sy, sz);
    this.#camera =
      this.#shake === 0
        ? camera
        : {
            fov: camera.fov,
            position: [camera.position[0] + sx, camera.position[1] + sy, camera.position[2] + sz],
            target: [camera.target[0] + sx, camera.target[1] + sy, camera.target[2] + sz],
          };
    this.#applyMood(moodAt(shot, local));
    this.#claims.apply(index, local, reducedMotion);
    this.#effects.begin();

    const counts = { squishies: 0, shadow: 0, keepers: 0, mine: false, hollow: false, seeds: 0 };
    const fires: BuildingPlacement[] = [];
    let hollow: { pose: ActorPose; y: number } | null = null;
    let shards: { pose: ActorPose; s: number } | null = null;
    const hexSize = timeline.cinematic.world.hexSize;

    for (const [i, s] of timeline.cinematic.shots.entries()) {
      for (const actor of s.actors) {
        const entry = this.#entries.get(key(i, actor.id));
        if (!entry) continue;
        const pose = i === index ? actorAt(actor, local, reducedMotion, s.duration) : null;
        const y = pose ? this.#world.groundAt(pose.x, pose.z) + pose.y : 0;
        switch (entry.kind) {
          case 'squishy':
            this.#poseSquishy(entry, pose, y);
            if (pose && entry.handle) {
              counts.squishies += 1;
              if (actor.shadow === true) counts.shadow += 1;
            }
            break;
          case 'keeper':
            this.#poseKeeper(entry, pose, y);
            if (pose && entry.handle) {
              counts.keepers += 1;
              if (entry.mine) counts.mine = true;
            }
            break;
          case 'seed': {
            const visible = pose !== null && pose.scale > 0.001;
            entry.mesh.setEnabled(visible);
            if (pose && visible) {
              entry.mesh.position.set(pose.x, y, pose.z);
              entry.mesh.scaling.setAll(pose.scale);
              const mat = entry.mesh.material;
              if (mat instanceof PBRMaterial) {
                const k = SEED_GLOW.min + (SEED_GLOW.max - SEED_GLOW.min) * pose.glow;
                SEED_PINK.scaleToRef(k, mat.emissiveColor);
              }
              counts.seeds += 1;
            }
            break;
          }
          case 'other':
            if (!pose) break;
            if (actor.kind === 'hollow-man') hollow = { pose, y };
            else if (actor.kind === 'hearthfire') {
              fires.push({
                buildingId: 'hearthfire',
                lit: pose.lit,
                x: pose.x,
                z: pose.z,
                y,
                scale: hexSize * ACTOR_SIZE.building * pose.scale,
                yaw: pose.yaw,
              });
            } else if (actor.kind === 'shards') {
              shards = { pose, s: local - (actor.path[0]?.at ?? 0) };
            } else if (actor.kind === 'heart-charm') {
              this.#effects.charm({ ...pose, y });
            } else if (actor.kind === 'hearts') {
              const s = local - (actor.path[0]?.at ?? 0);
              this.#effects.puff({ x: pose.x, y, z: pose.z, s, glow: pose.glow });
            } else if (actor.kind === 'joy') {
              this.#effects.joy({ ...pose, y });
            }
        }
      }
    }

    this.#effects.end();
    if (hollow) {
      const { pose, y } = hollow;
      // His eyes flare as he reaches, but never for reduced motion (no flashes).
      const flare = reducedMotion ? 0 : pose.reach;
      this.#hollow.pose({ x: pose.x, y, z: pose.z }, pose.alpha, pose.scale, pose.reach, flare);
      this.#reach = { reach: pose.reach, flare };
    } else {
      this.#hollow.pose(ORIGIN, 0);
      this.#reach = { reach: 0, flare: 0 };
    }
    counts.hollow = hollow !== null && hollow.pose.alpha > 0.001;

    if (shards) {
      const { pose, s } = shards;
      this.#shards.show(s, { x: pose.x, y: pose.y, z: pose.z }, pose.glow);
    } else {
      this.#shards.hide();
    }
    this.#shardsOn = shards !== null && shards.pose.glow > 0.001;

    // A Hearthfire can grow in ("Your part"), so its size is part of the key.
    const firesKey = fires
      .map((f) => `${f.x},${f.z},${(f.scale ?? 1).toFixed(3)},${String(f.lit)}`)
      .join('|');
    if (firesKey !== this.#fires) {
      this.#fires = firesKey;
      this.#buildings.set(fires);
    }
    this.#litFires = fires.filter((f) => f.lit === true).length;
    this.#world.snowAt(t);
    this.#counts = counts;
  }

  #poseSquishy(
    entry: Extract<Entry, { kind: 'squishy' }>,
    pose: ActorPose | null,
    y: number,
  ): void {
    if (!pose || pose.scale <= 0.001) {
      if (entry.handle) this.#squishies.remove(entry.handle);
      entry.handle = null;
      entry.last = '';
      return;
    }
    const placement = { x: pose.x, z: pose.z, y, yaw: pose.yaw, scale: pose.scale };
    const next = poseKey(pose, y);
    if (!entry.handle) {
      const look = entry.actor.shadow === true ? 'shadow' : 'normal';
      entry.handle = this.#squishies.add(entry.species, entry.actor.id, placement, look);
    } else if (next !== entry.last) {
      this.#squishies.move(entry.handle, placement);
    }
    entry.last = next;
  }

  #poseKeeper(entry: Extract<Entry, { kind: 'keeper' }>, pose: ActorPose | null, y: number): void {
    if (!pose || pose.scale <= 0.001) {
      if (entry.handle) this.#keepers.remove(entry.handle);
      entry.handle = null;
      entry.last = '';
      return;
    }
    const placement = {
      x: pose.x,
      z: pose.z,
      y,
      yaw: pose.yaw,
      scale: pose.scale,
      lean: ACTOR_SIZE.keeperLean,
    };
    const next = poseKey(pose, y);
    if (!entry.handle) {
      entry.handle = this.#keepers.add(entry.config, placement, entry.items);
    } else if (next !== entry.last) {
      this.#keepers.move(entry.handle, placement);
    }
    entry.last = next;
  }

  #play(id: string, move: 'jiggle' | 'wobble' | 'bounce', now: number): void {
    const entry = this.#entries.get(id);
    if (entry?.kind === 'squishy' && entry.handle) this.#squishies.play(entry.handle, move, now);
    if (entry?.kind === 'keeper' && entry.handle) this.#keepers.play(entry.handle, move, now);
  }

  #applyMood(mood: Mood): void {
    this.#mood = mood;
    const { drain, night, glow } = mood;
    const ip = this.#scene.imageProcessingConfiguration;
    if (ip.colorCurves) {
      ip.colorCurves.globalSaturation = DRAIN.saturation * drain;
      ip.colorCurves.globalExposure = DRAIN.exposure * drain;
    }
    ip.vignetteWeight = DRAIN.vignetteWeight * drain;
    if (this.#sun) this.#sun.intensity = this.#base.sun * (1 - (1 - NIGHT_LIGHT.sun) * night);
    this.#scene.environmentIntensity =
      this.#base.environment * (1 - (1 - NIGHT_LIGHT.environment) * night);
    // The sky isn't drawn by a material, so it drains by hand.
    Color3.LerpToRef(this.#daySky, this.#nightSky, night, this.#sky);
    const sky = this.#sky;
    const grey = (sky.r + sky.g + sky.b) / 3;
    const k = DRAIN.skyGrey * drain;
    this.#clear.set(
      sky.r + (grey - sky.r) * k,
      sky.g + (grey - sky.g) * k,
      sky.b + (grey - sky.b) * k,
      1,
    );
    this.#scene.clearColor = this.#clear;
    this.#world.setGlow(glow);
  }

  /** Advances squish moves and breathing; true while any plays. */
  update(now: number): boolean {
    const a = this.#squishies.update(now);
    const b = this.#keepers.update(now);
    return a || b;
  }

  setLod(lod: SquishyLod): void {
    this.#squishies.setLod(lod);
    this.#keepers.setLod(lod);
  }

  get stats(): CinematicSceneStats {
    const shot = this.#options.timeline.cinematic.shots[this.#shot];
    return {
      shot: shot?.id ?? '',
      squishies: this.#counts.squishies,
      shadowSquishies: this.#counts.shadow,
      keepers: this.#counts.keepers,
      playerKeeper: this.#counts.mine,
      hollowMan: this.#counts.hollow,
      seeds: this.#counts.seeds,
      shards: this.#shardsOn,
      litFires: this.#litFires,
      drain: this.#mood.drain,
      tiles: this.#world.stats.tiles,
      claimed: this.#claims.shown,
      ...this.#effects.counts,
      ...this.#reach,
      shake: this.#shake,
    };
  }

  dispose(): void {
    this.#squishies.dispose();
    this.#keepers.dispose();
    this.#hollow.dispose();
  }
}
