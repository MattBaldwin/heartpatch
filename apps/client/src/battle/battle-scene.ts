import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import {
  KEEPER_DATA,
  type BattleSideId,
  type BattleTimeOfDay,
  type FeelingId,
  type KeeperConfig,
  type Species,
  type VisualRegistry,
} from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import type { SceneContent } from '../engine/stage.js';
import {
  CONTACT_SHADOW,
  type SquishMove,
  type SquishyLod,
  type SquishyLook,
} from '../procedural/config.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { buildFence } from '../map/fence-props.js';
import { vinyl } from '../map/map-scene.js';
import { arenaPlan, arenaSeed } from './arena-layout.js';
import { buildArena, type Arena, type ArenaStats } from './arena.js';
import { BATTLE_CAMERA, CHOREO, FIGHTER, HOMES, SHIELD_BUBBLE } from './battle-config.js';
import type { PlaybackStep } from './battle-playback.js';
import type { BattleContent } from './battle-view.js';
import { CameraDirector, type FitPoint, type SafeRegion } from './camera-director.js';
import {
  actPose,
  actRunning,
  heldPose,
  planStep,
  readyPose,
  REST,
  type Act,
  type ActKind,
  type EffectCue,
  type Pose,
  type SquishCue,
} from './choreography.js';
import { EffectPool, type EffectStats } from './effects.js';
import { emit, type Point } from './element-fx.js';

/*
 * The battle scene (owner decision 2026-10-05): Lantern Hour's stage
 * (arena.ts), two fighters on rigs posed by Saturday Morning Smackdown's
 * choreography (choreography.ts), the player's Keeper at their back, pooled
 * effects (effects.ts), long soft shadows, and the camera director's shot
 * written into the stage camera before each frame. Every squishy is a
 * `(species, instanceId)` look, so the wild squishy is the same on every
 * refresh and the player's is the one from their map. In a rescue the other
 * side are the Hollow's shadows (the field's shadow look).
 *
 * Performance (CLAUDE.md rule 8): every mesh and material is made when the
 * scene is built (`prewarm` builds the benches too); a turn only moves
 * transform nodes, writes preallocated instance buffers, and flips pooled
 * effect meshes on and off. Nothing is allocated per frame but a few small
 * pose objects.
 */

export interface BattleSceneStats {
  readonly squishies: number;
  readonly meshes: number;
  readonly instances: number;
  /** Squishies out with the shadow look (a rescue's guardians). */
  readonly shadowLook: number;
  readonly lod: SquishyLod;
  /** The player's Keeper is in the arena. */
  readonly keeper: boolean;
  readonly arena: ArenaStats;
  readonly effects: EffectStats;
  /** Acts played so far (dashes, knockbacks, flops…). */
  readonly acts: number;
  /** Fighters lying tuckered out. */
  readonly down: number;
  readonly reducedMotion: boolean;
  /** Draw calls in the last frame drawn (0 before the first). */
  readonly drawCalls: number;
  /** Where the camera is (the dev hook: a gesture on the fight must not move it). */
  readonly camera: { x: number; y: number; z: number } | null;
  /** The current step's clock: what is playing and how far in, ms (the dev hook). */
  readonly playing: { kind: PlaybackStep['kind']; at: number } | null;
}

export interface BattleSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly tier: QualityTier;
  readonly content: BattleContent;
  /** The player's side stands at the front. */
  readonly mySide: BattleSideId;
  /** The player's Keeper, standing behind their squishy; null if not known. */
  readonly keeper: KeeperConfig | null;
  /** What the Keeper wears (#43): clothing ids. */
  readonly keeperWearing?: readonly string[];
  /** How the other side's squishies look: `shadow` in a rescue (owner decision 7). */
  readonly opponentLook?: SquishyLook;
  /** Where the battle happens (the server's `PlayerBattle.terrain` and `timeOfDay`). */
  readonly terrain: string;
  readonly timeOfDay: BattleTimeOfDay;
  /** Seeds the arena, so a battle always looks the same. */
  readonly battleId: string;
  /** `prefers-reduced-motion`: no shake, flash, hit-stop or idle bounce; smaller moves. */
  readonly reducedMotion: boolean;
  /** Where the fight may be drawn: between the HUD's pills and its sheet (fractions of the height). */
  readonly safe: () => SafeRegion;
}

/** A squishy that may come out for a side (or a fence, #203: its building id). */
export interface TeamMember {
  readonly speciesId: string;
  readonly instanceId: string;
  /** A fence's level, for its look. */
  readonly level?: number;
}

interface Fighter {
  readonly handle: SquishyHandle;
  readonly species: Species;
  readonly feeling: FeelingId;
  readonly height: number;
  readonly radius: number;
}

/**
 * A fence segment standing in for a squishy (#203): its model from the map's
 * fence looks, scaled up. It never moves by itself, but rides the rig, so a
 * hit wobbles it and tuckering out lays it flat.
 */
interface FenceStand {
  readonly mesh: Mesh;
  readonly height: number;
  readonly radius: number;
}

interface Rig {
  readonly side: BattleSideId;
  readonly root: TransformNode;
  readonly tilt: TransformNode;
  readonly turn: TransformNode;
  readonly field: SquishyField;
  readonly home: { x: number; z: number };
  /** Unit vector towards the other fighter. */
  readonly fx: number;
  readonly fz: number;
  /** Three-quarter facing, radians off the rig's own heading. */
  readonly yaw: number;
  readonly phase: number;
  readonly bench: Map<string, Fighter>;
  out: Fighter | null;
  /** Fences built for this side (#203), by id, and the one out (null: none). */
  readonly fences: Map<string, FenceStand>;
  fence: FenceStand | null;
  act: Act | null;
  pose: Pose;
  /** Flopped over (tuckered out). */
  down: boolean;
}

interface ActCueAt {
  readonly rig: Rig;
  readonly kind: ActKind;
  readonly at: number;
  readonly ms: number;
  readonly strength: number;
}

interface EffectCueAt {
  readonly cue: EffectCue;
  readonly at: number;
  readonly duration: number;
}

interface SquishCueAt {
  readonly cue: SquishCue;
  readonly at: number;
}

const SIDES: readonly BattleSideId[] = ['a', 'b'];
/** Each fighter's two contact shadows: the whole and a softer inner share. */
const SHADOW_SHARES: readonly number[] = [1, 0.72];

export class BattleScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #options: BattleSceneOptions;
  /** The mood's contact-shadow stretch, read once (the shadows are written every frame). */
  readonly #shadowStretch: number;
  readonly #arena: Arena;
  readonly #rigs: Record<BattleSideId, Rig>;
  readonly #keepers: KeeperField;
  readonly #keeper: KeeperHandle | null;
  readonly #effects: EffectPool;
  /** A potion's sparkle shield over each side's squishy (#214), made with the scene. */
  readonly #bubbles: Record<BattleSideId, Mesh>;
  readonly #bubbleMaterial: StandardMaterial;
  /** Shared by every fence (#203); made with the first. */
  #fenceMaterial: Material | null = null;
  readonly #shielded: Record<BattleSideId, boolean> = { a: false, b: false };
  readonly #camera: CameraDirector;
  readonly #shadows: Mesh;
  readonly #shadowMatrices = new Float32Array(4 * 16);
  readonly #fit: FitPoint[] = [
    { x: 0, z: 0, r: 0, h: 0 },
    { x: 0, z: 0, r: 0, h: 0 },
    { x: 0, z: 0, r: 0, h: 0 },
    { x: 0, z: 0, r: 0, h: 0 },
  ];
  readonly #instrumentation: SceneInstrumentation;
  readonly #beforeRender: Observer<Scene>;
  readonly #afterRender: Observer<Scene>;
  readonly #projection = new Matrix();
  readonly #lookAt = new Vector3();
  readonly #right = new Vector3();
  readonly #up = new Vector3();
  readonly #forward = new Vector3();
  #actCues: ActCueAt[] = [];
  #effectCues: EffectCueAt[] = [];
  #squishCues: SquishCueAt[] = [];
  readonly #pendingSwaps: { side: BattleSideId; at: number; member: TeamMember }[] = [];
  /** The last move played, for the hit that follows it. */
  #lastMove: { move: string; user: BattleSideId } | null = null;
  #playing: { kind: PlaybackStep['kind']; start: number; ms: number } | null = null;
  #now = 0;
  #acts = 0;
  #salt = 1;
  #drawCalls = 0;
  #casterMeshes = -1;
  #imageProcessed = false;

  constructor(scene: Scene, options: BattleSceneOptions) {
    this.#scene = scene;
    this.#options = options;
    const lowTier = options.tier === 'low';
    this.#instrumentation = new SceneInstrumentation(scene);
    const plan = arenaPlan(options.terrain, options.timeOfDay, arenaSeed(options.battleId));
    this.#shadowStretch = plan.mood.shadowStretch;
    this.#arena = buildArena(scene, { plan, lowTier, reducedMotion: options.reducedMotion });

    const homeOf = (side: BattleSideId) => (side === options.mySide ? HOMES.mine : HOMES.theirs);
    this.#rigs = {
      a: this.#rig(
        'a',
        homeOf('a'),
        homeOf('b'),
        CHOREO.ready.otherPhase * (options.mySide === 'a' ? 0 : 1),
      ),
      b: this.#rig(
        'b',
        homeOf('b'),
        homeOf('a'),
        CHOREO.ready.otherPhase * (options.mySide === 'b' ? 0 : 1),
      ),
    };

    // The player's Keeper, at their squishy's back like a coach, seen in the gap between the fighters.
    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    const place = KEEPER_PLACES.battle;
    this.#keeper = options.keeper
      ? this.#keepers.add(
          options.keeper,
          {
            x: HOMES.mine.x + FIGHTER.keeper.offset.x,
            z: HOMES.mine.z + FIGHTER.keeper.offset.z,
            yaw: FIGHTER.keeper.yaw,
            lean: place.lean * FIGHTER.keeper.leanShare,
            scale: place.scale,
          },
          keeperItems(options.keeperWearing ?? []),
        )
      : null;

    // Fighter contact shadows, stretched along the key light (long golden-hour shadows).
    this.#shadows = createContactShadowMesh(scene);
    this.#shadows.name = 'battle-fighter-shadows';
    this.#shadows.thinInstanceSetBuffer('matrix', this.#shadowMatrices, 16, false);
    this.#shadows.alwaysSelectAsActiveMesh = true;

    this.#effects = new EffectPool(scene);
    // One soft, glassy bubble per side, hidden until a potion puts it up.
    this.#bubbleMaterial = new StandardMaterial('battle-shield-bubble', scene);
    this.#bubbleMaterial.diffuseColor = new Color3(...SHIELD_BUBBLE.color);
    this.#bubbleMaterial.emissiveColor = new Color3(...SHIELD_BUBBLE.glow);
    this.#bubbleMaterial.specularColor = new Color3(1, 1, 1);
    this.#bubbleMaterial.specularPower = 48;
    this.#bubbleMaterial.alpha = SHIELD_BUBBLE.alpha;
    const bubble = (side: BattleSideId) => {
      const mesh = CreateSphere(`battle-shield-${side}`, { diameter: 1, segments: 16 }, scene);
      mesh.material = this.#bubbleMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      return mesh;
    };
    this.#bubbles = { a: bubble('a'), b: bubble('b') };
    this.#camera = new CameraDirector(
      { a: this.#rigs.a.home, b: this.#rigs.b.home },
      options.reducedMotion,
    );

    // The stage's camera is the map camera with no input reaching it (the
    // HUD's shield sits over the canvas, so its gesture handlers never fire):
    // the director's shot is written into it just before each render (camera
    // matrices are worked out after `onBeforeRender`).
    this.#beforeRender = scene.onBeforeRenderObservable.add(() => {
      this.#frame();
    });
    this.#afterRender = scene.onAfterRenderObservable.add(() => {
      this.#drawCalls = this.#instrumentation.drawCallsCounter.current;
    });

    this.content = {
      bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
      start: { x: 0, z: 0 },
    };
  }

  #rig(
    side: BattleSideId,
    home: { x: number; z: number },
    other: { x: number; z: number },
    phase: number,
  ): Rig {
    const scene = this.#scene;
    const dx = other.x - home.x;
    const dz = other.z - home.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const root = new TransformNode(`battle-rig-${side}`, scene);
    const tilt = new TransformNode(`battle-rig-${side}-tilt`, scene);
    const turn = new TransformNode(`battle-rig-${side}-turn`, scene);
    tilt.parent = root;
    turn.parent = tilt;
    root.position.set(home.x, 0, home.z);
    const facing = Math.atan2(fx, fz); // local +z points at the other fighter
    root.rotation.y = facing;
    // Three-quarter: the face turns between "at the other" and "at the camera" (−z).
    const k = side === this.#options.mySide ? FIGHTER.facing.mine : FIGHTER.facing.theirs;
    const wx = fx * k;
    const wz = fz * k - (1 - k);
    const yaw = faceYaw(wx, wz) - facing;
    const field = new SquishyField(scene, {
      registry: this.#options.registry,
      lod: this.#options.lod,
      shadows: false,
      parent: turn,
      breathing: !this.#options.reducedMotion,
    });
    return {
      side,
      root,
      tilt,
      turn,
      field,
      home,
      fx,
      fz,
      yaw,
      phase,
      bench: new Map(),
      out: null,
      fences: new Map(),
      fence: null,
      act: null,
      pose: REST,
      down: false,
    };
  }

  /**
   * Builds every squishy that might come out for `side` now (hidden until
   * `sendOut`), so a swap mid-turn makes no meshes.
   */
  prewarm(side: BattleSideId, team: readonly TeamMember[]): void {
    for (const member of team) {
      if (!this.#fighter(side, member.speciesId, member.instanceId)) {
        this.#fenceStand(side, member.speciesId, member.instanceId, member.level ?? 1);
      }
    }
    this.#rigs[side].field.flush();
  }

  #fighter(side: BattleSideId, speciesId: string, instanceId: string): Fighter | null {
    const rig = this.#rigs[side];
    const known = rig.bench.get(instanceId);
    if (known) return known;
    const species = this.#options.content.species.get(speciesId);
    if (!species) return null; // unknown species: nothing to draw, the HUD still names it
    const look =
      side === this.#options.mySide ? 'normal' : (this.#options.opponentLook ?? 'normal');
    // The rig's turn node carries the yaw; the field only scales. Hidden at scale 0 until it's out.
    const handle = rig.field.add(species, instanceId, { x: 0, z: 0, yaw: 0, scale: 0 }, look);
    const body = this.#options.registry.bodies.get(handle.params.body.id);
    const [sx, , sz] = handle.params.body.scale;
    const fighter: Fighter = {
      handle,
      species,
      feeling: species.feeling,
      height: handle.params.height * FIGHTER.scale,
      radius: (Math.max((body?.width ?? 1) * sx, (body?.depth ?? 1) * sz) * FIGHTER.scale) / 2,
    };
    rig.bench.set(instanceId, fighter);
    return fighter;
  }

  /** A fence for `side` (#203), built hidden the first time; null when `id` isn't a fence. */
  #fenceStand(
    side: BattleSideId,
    id: string,
    instanceId: string,
    level: number,
  ): FenceStand | null {
    const rig = this.#rigs[side];
    const known = rig.fences.get(instanceId);
    if (known) return known;
    if (!this.#options.content.fences.has(id)) return null;
    const length = FIGHTER.fence.length;
    const mesh = buildFence(this.#scene, id, level, length);
    mesh.material = this.#fenceMaterial ??= vinyl(this.#scene, 'battle-fence-mat', {
      color: '#ffffff',
    });
    mesh.parent = rig.turn;
    mesh.scaling.setAll(FIGHTER.fence.scale);
    // Across the line between the fighters, a little towards the camera.
    mesh.rotation.y = -rig.yaw;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    const { maximum } = mesh.getBoundingInfo().boundingBox;
    const stand: FenceStand = {
      mesh,
      height: Math.max(0.6, maximum.y * FIGHTER.fence.scale),
      radius: (length * FIGHTER.fence.scale) / 4,
    };
    rig.fences.set(instanceId, stand);
    return stand;
  }

  /** Puts `speciesId` out for `side` (replacing whoever was out); a fence id puts a fence up. */
  sendOut(side: BattleSideId, speciesId: string, instanceId: string, level = 1): void {
    const rig = this.#rigs[side];
    const next = this.#fighter(side, speciesId, instanceId);
    if (rig.out && rig.out !== next) {
      rig.field.move(rig.out.handle, { x: 0, z: 0, yaw: 0, scale: 0 });
    }
    rig.out = next;
    const fence = next ? null : this.#fenceStand(side, speciesId, instanceId, level);
    if (rig.fence && rig.fence !== fence) rig.fence.mesh.setEnabled(false);
    rig.fence = fence;
    fence?.mesh.setEnabled(true);
    rig.down = false;
    if (next) rig.field.move(next.handle, { x: 0, z: 0, yaw: 0, scale: FIGHTER.scale });
    rig.act = null;
    rig.pose = REST;
    this.#apply(rig, REST);
  }

  /** Lays a side's squishy down at once (a resumed battle where it's already tuckered out). */
  knockedOut(side: BattleSideId): void {
    const rig = this.#rigs[side];
    rig.down = true;
    rig.act = {
      kind: 'faint',
      start: this.#now - 10_000,
      ms: 1,
      from: REST,
      reach: this.#reach(rig),
      strength: 1,
      feeling: rig.out?.feeling ?? 'cozy',
      reduced: this.#options.reducedMotion,
    };
    this.#apply(rig, heldPose('faint', 0, this.#options.reducedMotion));
  }

  /** Acts a step of the log out, starting at `now` (choreography.ts). */
  perform(
    step: PlaybackStep,
    now: number,
    extra: { incoming?: TeamMember; captured?: boolean } = {},
  ): void {
    this.#now = now;
    const other = step.side === 'a' ? 'b' : 'a';
    if ((step.kind === 'move' || step.kind === 'miss') && step.move) {
      this.#lastMove = { move: step.move, user: step.side };
    }
    const moveId = step.kind === 'move' || step.kind === 'miss' ? step.move : this.#lastMove?.move;
    const user = step.kind === 'move' || step.kind === 'miss' ? step.side : this.#lastMove?.user;
    const plan = planStep(step, {
      move: moveId ? (this.#options.content.moves.get(moveId) ?? null) : null,
      user: user ?? null,
      mySide: this.#options.mySide,
      reduced: this.#options.reducedMotion,
      ...(extra.captured !== undefined ? { captured: extra.captured } : {}),
    });
    this.#playing = { kind: step.kind, start: now, ms: step.ms };
    for (const cue of plan.acts) {
      const rig = this.#rigs[cue.side];
      if (cue.kind === 'swap-in' && extra.incoming) {
        // The new squishy comes out when the drop starts (the old one has hopped away).
        const incoming = extra.incoming;
        this.#actCues.push({ rig, kind: 'swap-out', at: now + cue.delay, ms: 0, strength: 0 });
        this.#effectCues.push({
          cue: { kind: 'dust', side: cue.side, delay: cue.delay, element: null, strength: 0 },
          at: now + cue.delay,
          duration: 0,
        });
        this.#squishCues.push({
          cue: { side: cue.side, move: 'jiggle', delay: cue.delay, strength: 0 },
          at: now + cue.delay,
        });
        // A marker cue: sendOut runs when it comes due (see #runActCue).
        this.#pendingSwaps.push({ side: cue.side, at: now + cue.delay, member: incoming });
      }
      this.#actCues.push({
        rig,
        kind: cue.kind,
        at: now + cue.delay,
        ms: cue.ms,
        strength: cue.strength,
      });
    }
    for (const cue of plan.effects) {
      const duration =
        cue.kind === 'trail'
          ? cue.strength * 1000
          : cue.kind === 'charm'
            ? step.ms * CHOREO.charm.wobbleAt
            : cue.kind === 'dizzy' || cue.kind === 'sleepy'
              ? step.kind === 'tuckered'
                ? 2200
                : step.ms * 0.9
              : 0;
      this.#effectCues.push({ cue, at: now + cue.delay, duration });
    }
    for (const cue of plan.squish) this.#squishCues.push({ cue, at: now + cue.delay });
    this.#camera.cue(plan.camera, now);
    // Anyone left at arm's length by a dash that landed nothing hops home.
    const bystander = step.kind === 'hit' ? null : this.#rigs[other];
    if (
      bystander &&
      bystander.act &&
      bystander.act.kind === 'dash' &&
      !plan.acts.some((a) => a.side === other)
    ) {
      this.#actCues.push({
        rig: bystander,
        kind: 'return',
        at: now,
        ms: CHOREO.returnMs,
        strength: 1,
      });
    }
  }

  /** The Keeper cheers or reacts (`keeperReaction`); a no-op without one. */
  cheer(move: SquishMove, now: number, strength = 1): void {
    if (this.#keeper) this.#keepers.play(this.#keeper, move, now, strength);
  }

  /** Back to framing both fighters (the log has played out). */
  restCamera(): void {
    this.#camera.rest();
    this.#playing = null;
  }

  /**
   * Advances everything to `now` (ms): starts due acts and effects, poses the
   * fighters, drifts the motes. True while anything moves, so the caller
   * keeps drawing.
   */
  update(now: number): boolean {
    this.#now = now;
    // Swaps that came due bring the new squishy out.
    for (let i = this.#pendingSwaps.length - 1; i >= 0; i--) {
      const swap = this.#pendingSwaps[i];
      if (swap && swap.at <= now) {
        this.#pendingSwaps.splice(i, 1);
        this.sendOut(swap.side, swap.member.speciesId, swap.member.instanceId, swap.member.level);
      }
    }
    // Acts that came due start from the pose the fighter is in now.
    this.#actCues = this.#actCues.filter((cue) => {
      if (cue.at > now) return true;
      this.#startAct(cue);
      return false;
    });
    this.#effectCues = this.#effectCues.filter((cue) => {
      if (cue.at > now) return true;
      this.#spawn(cue);
      return false;
    });
    this.#squishCues = this.#squishCues.filter((cue) => {
      if (cue.at > now) return true;
      const rig = this.#rigs[cue.cue.side];
      if (rig.out && cue.cue.strength > 0)
        rig.field.play(rig.out.handle, cue.cue.move, now, cue.cue.strength);
      return false;
    });
    let moving =
      this.#actCues.length > 0 || this.#effectCues.length > 0 || this.#squishCues.length > 0;
    for (const side of SIDES) {
      const rig = this.#rigs[side];
      const running = actRunning(rig.act, now);
      let pose: Pose;
      if (
        rig.act &&
        (running ||
          rig.act.kind === 'faint' ||
          rig.act.kind === 'swap-out' ||
          rig.act.kind === 'scoot' ||
          rig.act.kind === 'charmed' ||
          rig.act.kind === 'dash')
      ) {
        pose = actPose(rig.act, now);
      } else {
        rig.act = null;
        pose = rig.out
          ? readyPose(now, rig.phase, rig.out.feeling, this.#options.reducedMotion)
          : REST;
        // Standing ready moves a little (a bob), unless motion is reduced.
        if (!this.#options.reducedMotion && rig.out && !rig.down) moving = true;
      }
      this.#apply(rig, pose);
      if (running) moving = true;
      if (rig.field.update(now)) moving = true;
    }
    if (this.#keepers.update(now)) moving = true;
    if (this.#effects.update(now)) moving = true;
    if (this.#arena.update(now)) moving = true;
    if (this.#camera.moving(now)) moving = true;
    this.#writeShadows();
    this.#placeBubbles();
    return moving;
  }

  /** True while an act, an effect or the camera is mid-motion (not just breathing or a bob). */
  isPlaying(now: number): boolean {
    for (const side of SIDES) {
      const rig = this.#rigs[side];
      if (actRunning(rig.act, now)) return true;
      if (rig.out && rig.field.isPlaying(rig.out.handle, now)) return true;
    }
    if (this.#actCues.length > 0 || this.#effectCues.length > 0 || this.#pendingSwaps.length > 0)
      return true;
    if (this.#effects.stats.live > 0) return true;
    if (this.#camera.moving(now)) return true;
    return this.#keeper !== null && this.#keepers.isPlaying(this.#keeper, now);
  }

  /** Shows or hides the sparkle shield over a side's squishy (from its pill's chips). */
  setShield(side: BattleSideId, on: boolean): void {
    this.#shielded[side] = on;
  }

  /** True while a side's sparkle shield shows (the dev hook and tests). */
  shieldShown(side: BattleSideId): boolean {
    return this.#bubbles[side].isEnabled();
  }

  #placeBubbles(): void {
    for (const side of SIDES) {
      const rig = this.#rigs[side];
      const fighter = rig.out;
      const mesh = this.#bubbles[side];
      const show = this.#shielded[side] && fighter !== null && !rig.down && rig.pose.scale > 0.05;
      mesh.setEnabled(show);
      if (!show) continue;
      const c = this.#centre(rig, rig.pose, fighter);
      mesh.position.set(c.x, c.y, c.z);
      const across = fighter.radius * 2 * SHIELD_BUBBLE.fit * rig.pose.scale;
      const tall = fighter.height * SHIELD_BUBBLE.fit * rig.pose.scale;
      mesh.scaling.set(across, Math.max(across, tall), across);
    }
  }

  setLod(lod: SquishyLod): void {
    for (const side of SIDES) this.#rigs[side].field.setLod(lod);
    this.#keepers.setLod(lod);
    this.#casterMeshes = -1;
  }

  get stats(): BattleSceneStats {
    const a = this.#rigs.a.field.stats;
    const b = this.#rigs.b.field.stats;
    return {
      squishies: (this.#rigs.a.out ? 1 : 0) + (this.#rigs.b.out ? 1 : 0),
      meshes: a.meshes + b.meshes,
      instances: a.instances + b.instances,
      shadowLook: a.shadowLook + b.shadowLook,
      lod: a.lod,
      keeper: this.#keeper !== null,
      arena: this.#arena.stats,
      effects: this.#effects.stats,
      acts: this.#acts,
      down: (this.#rigs.a.down ? 1 : 0) + (this.#rigs.b.down ? 1 : 0),
      reducedMotion: this.#options.reducedMotion,
      drawCalls: this.#drawCalls,
      camera: this.#cameraStat(),
      playing: this.#playing
        ? { kind: this.#playing.kind, at: this.#now - this.#playing.start }
        : null,
    };
  }

  get hasKeeper(): boolean {
    return this.#keeper !== null;
  }

  #cameraStat(): { x: number; y: number; z: number } | null {
    const cam = this.#scene.activeCamera;
    if (!cam) return null;
    const { x, y, z } = cam.position;
    return { x, y, z };
  }

  dispose(): void {
    this.#scene.onBeforeRenderObservable.remove(this.#beforeRender);
    this.#scene.onAfterRenderObservable.remove(this.#afterRender);
    this.#effects.dispose();
    for (const side of SIDES) this.#bubbles[side].dispose();
    this.#bubbleMaterial.dispose();
    this.#fenceMaterial?.dispose();
    this.#keepers.dispose();
    for (const side of SIDES) {
      const rig = this.#rigs[side];
      rig.field.dispose();
      rig.root.dispose();
    }
    this.#shadows.material?.dispose(true, true);
    this.#shadows.dispose();
    this.#arena.dispose();
    this.#instrumentation.dispose();
  }

  // ── Internals ─────────────────────────────────────────────────────────

  #reach(rig: Rig): number {
    const other = this.#rigs[rig.side === 'a' ? 'b' : 'a'];
    const gap = Math.hypot(other.home.x - rig.home.x, other.home.z - rig.home.z);
    return Math.max(
      0.4,
      gap -
        ((rig.out ?? rig.fence)?.radius ?? 1) -
        ((other.out ?? other.fence)?.radius ?? 1) -
        0.05,
    );
  }

  #startAct(cue: ActCueAt): void {
    const { rig } = cue;
    if (cue.ms === 0) return; // a swap marker: sendOut ran from the pending swaps
    // A tuckered-out squishy stays flopped: only a swap moves it (the log
    // never asks a down squishy to cheer, pop out or return, so nothing is lost).
    if (rig.down && cue.kind !== 'swap-in' && cue.kind !== 'swap-out') return;
    this.#acts += 1;
    if (cue.kind === 'faint') rig.down = true;
    if (cue.kind === 'swap-in' || cue.kind === 'pop-out') rig.down = false;
    rig.act = {
      kind: cue.kind,
      start: cue.at,
      ms: cue.ms,
      from: rig.pose,
      reach: this.#reach(rig),
      strength: cue.strength,
      feeling: rig.out?.feeling ?? 'cozy',
      reduced: this.#options.reducedMotion,
    };
  }

  #spawn(c: EffectCueAt): void {
    const { cue } = c;
    const rig = this.#rigs[cue.side];
    const fighter = rig.out ?? rig.fence;
    if (!fighter) return;
    const other = this.#rigs[cue.side === 'a' ? 'b' : 'a'];
    const at = { ...this.#centre(rig, rig.pose, fighter) };
    let to: Point | undefined;
    let path: ((t: number) => Point) | undefined;
    if (cue.kind === 'impact') {
      // The bonk lands on the target's near side, towards the attacker.
      at.x -= rig.fx * fighter.radius * 0.55;
      at.z -= rig.fz * fighter.radius * 0.55;
    }
    if (cue.kind === 'dizzy' && rig.down) at.y = Math.max(0.3, fighter.height * 0.3);
    if (cue.kind === 'charm') {
      const k = this.#keeper ? this.#keepers.centre(this.#keeper) : null;
      to = k
        ? { x: k.x, y: k.y + 0.3, z: k.z }
        : this.#centre(other, other.pose, other.out ?? other.fence);
    }
    if (cue.kind === 'bolt') to = this.#centre(other, other.pose, other.out ?? other.fence);
    if (cue.kind === 'trail') {
      const act = rig.act;
      path = (t) => this.#centre(rig, act ? actPose(act, t) : rig.pose, fighter);
    }
    this.#effects.spawn(
      emit({
        kind: cue.kind,
        element: cue.element,
        strength: cue.strength,
        now: c.at,
        at,
        height: fighter.height,
        ...(to ? { to } : {}),
        ...(path ? { path } : {}),
        ...(c.duration > 0 ? { duration: c.duration } : {}),
        salt: this.#salt++,
        ...(cue.caught !== undefined ? { caught: cue.caught } : {}),
        reduced: this.#options.reducedMotion,
      }),
    );
  }

  #centre(rig: Rig, p: Pose, fighter: Pick<Fighter, 'height'> | null): Point {
    const h = fighter?.height ?? 2;
    return {
      x: rig.home.x + rig.fx * p.forward + rig.fz * p.side,
      y: Math.max(0.2, p.lift + (h * p.squash * p.scale) / 2),
      z: rig.home.z + rig.fz * p.forward - rig.fx * p.side,
    };
  }

  #apply(rig: Rig, p: Pose): void {
    rig.pose = p;
    const sideX = rig.fz;
    const sideZ = -rig.fx;
    rig.root.position.set(
      rig.home.x + rig.fx * p.forward + sideX * p.side,
      p.lift,
      rig.home.z + rig.fz * p.forward + sideZ * p.side,
    );
    rig.tilt.rotation.set(p.lean, 0, p.roll);
    const width = 1 / Math.sqrt(Math.max(0.2, p.squash * p.stretch));
    const s = Math.max(0.001, p.scale);
    rig.tilt.scaling.set(width * s, p.squash * s, width * p.stretch * s);
    rig.turn.rotation.y = rig.yaw + p.spin;
  }

  #writeShadows(): void {
    const stretch = this.#options.reducedMotion ? 1.2 : this.#shadowStretch;
    const k = this.#arena.keyDir;
    // Shadows fall away from the light: along the key's horizontal direction.
    const alen = Math.hypot(k.x, k.z) || 1;
    const ux = k.x / alen;
    const uz = k.z / alen;
    const m = this.#shadowMatrices;
    let i = 0;
    for (const side of SIDES) {
      const rig = this.#rigs[side];
      for (const share of SHADOW_SHARES) {
        const o = i * 16;
        i++;
        const fighter = rig.out;
        if (!fighter || rig.pose.scale < 0.05) {
          m.fill(0, o, o + 16);
          m[o + 15] = 1;
          continue;
        }
        const p = rig.pose;
        const lifted = Math.max(0.35, 1 - Math.max(0, p.lift) / (fighter.height * 1.2));
        const d = fighter.radius * 2 * CONTACT_SHADOW.scale * p.scale * lifted * share;
        const across = d;
        const along = d * stretch;
        m[o] = -uz * across;
        m[o + 1] = 0;
        m[o + 2] = ux * across;
        m[o + 3] = 0;
        m[o + 4] = 0;
        m[o + 5] = 1;
        m[o + 6] = 0;
        m[o + 7] = 0;
        m[o + 8] = ux * along;
        m[o + 9] = 0;
        m[o + 10] = uz * along;
        m[o + 11] = 0;
        const shift = (stretch - 1) * d * 0.5;
        m[o + 12] = rig.root.position.x + ux * shift;
        m[o + 13] = 0.015 + i * 0.002;
        m[o + 14] = rig.root.position.z + uz * shift;
        m[o + 15] = 1;
      }
    }
    this.#shadows.thinInstanceBufferUpdated('matrix');
  }

  /** Every squishy and Keeper mesh casts into the shadow map (rebuilt after a detail change). */
  #registerCasters(): void {
    const shadows = this.#arena.shadows;
    if (!shadows) return;
    if (this.#scene.meshes.length === this.#casterMeshes) return;
    this.#casterMeshes = this.#scene.meshes.length;
    const map = shadows.getShadowMap();
    if (map?.renderList) map.renderList.length = 0;
    for (const m of this.#scene.meshes) {
      if (!(m.name.startsWith('squishy-') || m.name.startsWith('keeper-'))) continue;
      if (m.name.includes('shadow')) continue;
      shadows.addShadowCaster(m, false);
    }
  }

  /** Before each render: the camera's shot, the effects' billboard basis, the shadow casters. */
  #frame(): void {
    const scene = this.#scene;
    if (!this.#imageProcessed) {
      this.#imageProcessed = true;
      this.#arena.applyImageProcessing(scene);
    }
    this.#registerCasters();
    const camera = scene.activeCamera;
    if (!(camera instanceof TargetCamera)) return;
    const engine = scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    // What must stay on screen: both fighters where they stand and where they are now.
    let i = 0;
    for (const side of SIDES) {
      const rig = this.#rigs[side];
      // Ears, tails and a squash all reach past the body; a wide margin keeps every bit on screen (#142).
      const r = (rig.out?.radius ?? 1) * 1.35 + 0.6;
      const h = (rig.out?.height ?? 2) * 1.25 + 0.3;
      const home = this.#fit[i++];
      const here = this.#fit[i++];
      if (home) {
        home.x = rig.home.x;
        home.z = rig.home.z;
        home.r = r;
        home.h = h;
      }
      if (here) {
        here.x = rig.root.position.x;
        here.z = rig.root.position.z;
        here.r = r;
        here.h = h + Math.max(0, rig.pose.lift);
      }
    }
    const shot = this.#camera.shot(this.#now, aspect, this.#options.safe(), this.#fit);
    camera.fov = shot.fov;
    camera.minZ = BATTLE_CAMERA.minZ;
    camera.maxZ = BATTLE_CAMERA.maxZ;
    camera.upVector.set(shot.up.x, shot.up.y, shot.up.z);
    camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    camera.setTarget(this.#lookAt.set(shot.target.x, shot.target.y, shot.target.z));
    // The lens shift: one entry of the projection matrix moves the picture up, no extra pass.
    camera.unfreezeProjectionMatrix();
    this.#projection.copyFrom(camera.getProjectionMatrix(true));
    this.#projection.addAtIndex(9, shot.shift);
    camera.freezeProjectionMatrix(this.#projection);
    // Billboarded effects (speed lines, rays) need the camera's basis.
    this.#forward
      .set(
        shot.target.x - shot.position.x,
        shot.target.y - shot.position.y,
        shot.target.z - shot.position.z,
      )
      .normalize();
    Vector3.CrossToRef(camera.upVector, this.#forward, this.#right);
    this.#right.normalize();
    Vector3.CrossToRef(this.#forward, this.#right, this.#up);
    this.#up.normalize();
    this.#effects.setCamera(this.#right, this.#up, this.#forward);
  }
}
