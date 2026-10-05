import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
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
  type KeeperConfig,
  type Move,
  type VisualRegistry,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import {
  CONTACT_SHADOW,
  type SquishMove,
  type SquishyLod,
  type SquishyLook,
} from '../procedural/config.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { ARENA_STAGE } from './arena-config.js';
import {
  arenaPlan,
  arenaSeed,
  FIGHTER_HOMES,
  groundColor,
  mixRgb,
  rgbHex,
  type ArenaPlan,
} from './arena-layout.js';
import { BattleArena, type ArenaStats } from './arena.js';
import { ARENA, BATTLE_CAMERA, CHOREO } from './battle-config.js';
import type { PlaybackStep } from './battle-playback.js';
import type { BattleContent } from './battle-view.js';
import { CameraDirector } from './camera-director.js';
import {
  ACT_END,
  actPose,
  actRunning,
  planStep,
  readyPose,
  REST,
  type Act,
  type ActCue,
  type Pose,
  type StepPlan,
} from './choreography.js';
import { EffectPool, type EffectStats } from './effects.js';
import { emit, type Point } from './element-fx.js';

// The battle arena (#13, design doc §6 and §19; owner decision 2026-10-04):
// a diorama of the terrain the battle happens on (arena.ts), the two
// squishies that are out, drawn with #9's squishy field at close-up detail,
// and the player's Keeper (#42) behind theirs. Each squishy hangs from a rig
// (three transform nodes), so the choreography (choreography.ts) can dash,
// knock back and flop it by moving nodes, never re-uploading its buffers.
// Effects come from a pool built up front (effects.ts), and the camera
// follows the fight (camera-director.ts). In a rescue the other side are the
// Hollow's shadows, drawn with the field's shadow look (owner decision 7).

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
  /** Acts (dashes, knockbacks, flops…) the fighters have played in this battle. */
  readonly acts: number;
  /** Fighters lying tuckered out now. */
  readonly down: number;
  readonly reducedMotion: boolean;
}

export interface BattleSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly content: BattleContent;
  /** The player's side stands at the front. */
  readonly mySide: BattleSideId;
  /** The player's Keeper, standing behind their squishy; null if not known. */
  readonly keeper: KeeperConfig | null;
  /** What the Keeper wears (#43): clothing ids. */
  readonly keeperWearing?: readonly string[];
  /**
   * How the other side's squishies look: `shadow` in a rescue, the Hollow's
   * shadows (owner decision 7). The player's own always look like themselves.
   */
  readonly opponentLook?: SquishyLook;
  /** Where the battle happens (the server's `terrain` and `timeOfDay`). */
  readonly terrain: string;
  readonly timeOfDay: BattleTimeOfDay;
  /** The battle's id: the arena's props scatter the same way every time it's shown. */
  readonly battleId: string;
  /** `prefers-reduced-motion`: no shake or flashes, gentler moves, no idle bob. */
  readonly reducedMotion: boolean;
}

/** One squishy's rig: root (where it stands, facing the other) → tilt (lean, roll, squash) → turn. */
interface Rig {
  readonly side: BattleSideId;
  readonly root: TransformNode;
  readonly tilt: TransformNode;
  readonly turn: TransformNode;
  readonly field: SquishyField;
  readonly home: { readonly x: number; readonly z: number };
  /** Unit vector towards the other fighter. */
  readonly fx: number;
  readonly fz: number;
  /** The squishy's own heading inside the rig (faces the camera a little). */
  readonly yaw: number;
  /** Out of step with the other fighter's idle bounce. */
  readonly phase: number;
  handle: SquishyHandle | null;
  height: number;
  /** Half its footprint (for arm's length and its shadow). */
  radius: number;
  act: Act | null;
  /** Acts waiting to start (a swap's out then in). */
  queue: ActCue[];
  /** A squishy waiting to come out once its swap-out has played. */
  incoming: { speciesId: string; instanceId: string; at: number } | null;
  pose: Pose;
}

export class BattleScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #options: BattleSceneOptions;
  readonly #plan: ArenaPlan;
  readonly #arena: BattleArena;
  readonly #rigs: Record<BattleSideId, Rig>;
  readonly #keepers: KeeperField;
  readonly #keeper: KeeperHandle | null;
  readonly #effects: EffectPool;
  readonly #director: CameraDirector;
  readonly #shadows: Mesh;
  readonly #shadowMatrices = new Float32Array(32);
  readonly #lookAt = new Vector3();
  readonly #projection = new Matrix();
  readonly #dust: string;
  #cameraHook: Observer<Scene> | null = null;
  /** Each side's team, for building its meshes again after a detail change (`prewarm`). */
  readonly #teams = new Map<BattleSideId, readonly { speciesId: string; instanceId: string }[]>();
  /** The battle clock at the last `update` (the camera hook poses for it). */
  #now = 0;
  #lod: SquishyLod;
  #salt = 1;
  #acts = 0;
  /** The last move each side used, for the hit or effect that follows it. */
  readonly #lastMove: Record<BattleSideId, Move | null> = { a: null, b: null };

  constructor(scene: Scene, options: BattleSceneOptions) {
    this.#scene = scene;
    this.#options = options;
    this.#lod = options.lod;
    this.#plan = arenaPlan(options.terrain, options.timeOfDay);
    this.#arena = new BattleArena(scene, this.#plan, {
      seed: arenaSeed(options.battleId),
      propShare: options.lod === 'low' ? ARENA_STAGE.lowTierProps : 1,
    });
    // Dust kicked up is the ground's colour, a little lighter.
    const dust = mixRgb(groundColor(this.#plan), [1, 1, 1], 0.35);
    this.#dust = rgbHex(dust);

    this.#rigs = { a: this.#rig('a'), b: this.#rig('b') };
    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    const mine = this.#rigs[options.mySide].home;
    const place = KEEPER_PLACES.battle;
    this.#keeper = options.keeper
      ? this.#keepers.add(
          options.keeper,
          {
            x: mine.x + place.offset.x,
            z: mine.z + place.offset.z,
            yaw: place.yaw,
            // The battle camera is low now: the Keeper stands nearly upright.
            lean: place.lean * ARENA.keeperLean,
            scale: place.scale,
          },
          keeperItems(options.keeperWearing ?? []),
        )
      : null;

    // The fighters' soft shadows stay on the ground while they hop and dash.
    this.#shadows = createContactShadowMesh(scene);
    this.#shadows.name = 'battle-fighter-shadows';
    this.#shadows.thinInstanceSetBuffer('matrix', this.#shadowMatrices, 16, false);
    this.#shadows.alwaysSelectAsActiveMesh = true;

    this.#effects = new EffectPool(scene);
    this.#director = new CameraDirector(
      { a: this.#rigs.a.home, b: this.#rigs.b.home },
      options.reducedMotion,
    );
    for (const rig of Object.values(this.#rigs)) this.#apply(rig, this.#layered(rig, 0));
    this.#writeShadows();

    // The stage's camera, posed every frame by the director. Hooked after the
    // map camera's own handler (added once the stage is up), so pinch input
    // can never fight the framing.
    this.content = {
      bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
      start: { x: 0, z: 0 },
    };
  }

  /** Where a side's squishy stands: mine at the front left, theirs across. */
  #rig(side: BattleSideId): Rig {
    const mine = side === this.#options.mySide;
    // The player's at the front left, the other across (the arena keeps props clear of both).
    const [front, back] = FIGHTER_HOMES;
    const home = (mine ? front : back) ?? { x: 0, z: 0 };
    const dx = -2 * home.x;
    const dz = -2 * home.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const scene = this.#scene;
    const root = new TransformNode(`battle-rig-${side}`, scene);
    const tilt = new TransformNode(`battle-rig-${side}-tilt`, scene);
    const turn = new TransformNode(`battle-rig-${side}-turn`, scene);
    tilt.parent = root;
    turn.parent = tilt;
    root.position.set(home.x, 0, home.z);
    // Local +z points at the other fighter.
    const facing = Math.atan2(fx, fz);
    root.rotation.y = facing;
    // Turned a little towards each other, faces still to the camera (the old
    // arena's `faceOff`), relative to the rig.
    const yaw = (mine ? -ARENA.faceOff : ARENA.faceOff) - facing;
    const field = new SquishyField(scene, {
      registry: this.#options.registry,
      lod: this.#options.lod,
      shadows: false,
      parent: turn,
      // Reduced motion: still squishies, like the close-up view.
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
      phase: mine ? 0 : CHOREO.ready.otherPhase,
      handle: null,
      height: 1,
      radius: 0.5,
      act: null,
      queue: [],
      incoming: null,
      pose: REST,
    };
  }

  /** Puts `speciesId` out for `side` (replacing whoever was out), standing ready. */
  sendOut(side: BattleSideId, speciesId: string, instanceId: string): void {
    const rig = this.#rigs[side];
    rig.incoming = null;
    if (rig.handle) rig.field.remove(rig.handle);
    rig.handle = null;
    rig.act = null;
    const species = this.#options.content.species.get(speciesId);
    if (!species) return; // unknown species: nothing to draw, the HUD still names it
    const look =
      side === this.#options.mySide ? 'normal' : (this.#options.opponentLook ?? 'normal');
    const handle = rig.field.add(
      species,
      instanceId,
      { x: 0, z: 0, yaw: rig.yaw, scale: ARENA.scale },
      look,
    );
    rig.handle = handle;
    const body = this.#options.registry.bodies.get(handle.params.body.id);
    const [sx, , sz] = handle.params.body.scale;
    rig.height = handle.params.height * ARENA.scale;
    rig.radius = (Math.max((body?.width ?? 1) * sx, (body?.depth ?? 1) * sz) * ARENA.scale) / 2;
  }

  /**
   * Builds every squishy on a side's team once, then puts them away, so a
   * swap later reuses meshes made now instead of building them mid-turn
   * (CLAUDE.md rule 8). Call before `sendOut`.
   */
  prewarm(side: BattleSideId, team: readonly { speciesId: string; instanceId: string }[]): void {
    const rig = this.#rigs[side];
    this.#teams.set(side, team);
    const look =
      side === this.#options.mySide ? 'normal' : (this.#options.opponentLook ?? 'normal');
    const handles: SquishyHandle[] = [];
    for (const { speciesId, instanceId } of team) {
      const species = this.#options.content.species.get(speciesId);
      if (species) handles.push(rig.field.add(species, instanceId, { x: 0, z: 0 }, look));
    }
    // Upload builds each batch's mesh; with no instances left it's only switched off.
    rig.field.flush();
    for (const handle of handles) rig.field.remove(handle);
    rig.field.flush();
  }

  /** Lying tuckered out already (a battle shown again after a flop). */
  knockedOut(side: BattleSideId): void {
    const rig = this.#rigs[side];
    rig.act = this.#act(rig, 'faint', -1e9, 1, 1, REST);
    rig.queue = [];
  }

  /** The Keeper cheers or reacts (`keeperReaction`); a no-op without one. */
  cheer(move: SquishMove, now: number, strength = 1): void {
    if (this.#keeper) this.#keepers.play(this.#keeper, move, now, strength);
  }

  /** Plays a squish move on the squishy that's out for `side` (a shader wobble, bounce or jiggle). */
  play(side: BattleSideId, move: SquishMove, now: number, strength = 1): void {
    const rig = this.#rigs[side];
    if (!rig.handle || this.#isDown(rig)) return;
    rig.field.play(rig.handle, move, now, strength);
  }

  /**
   * Plays one step of the log: the fighters' acts, the effects, squish moves
   * and the camera's beat (choreography.ts). `incoming`: for a swap, who
   * comes out (after the old one has hopped away). Returns the plan.
   */
  perform(
    step: PlaybackStep,
    now: number,
    extra: { incoming?: { speciesId: string; instanceId: string }; captured?: boolean } = {},
  ): StepPlan {
    if (step.kind === 'move' && step.move) {
      this.#lastMove[step.side] = this.#options.content.moves.get(step.move) ?? null;
    }
    // A hit or an effect is about the move the other side (or itself) just used.
    const user: BattleSideId =
      step.kind === 'move' || step.kind === 'miss' ? step.side : other(step.side);
    const move =
      step.kind === 'heal' || step.kind === 'effect'
        ? (this.#lastMove[step.side] ?? this.#lastMove[user])
        : this.#lastMove[user];
    const plan = planStep(step, {
      move,
      user,
      mySide: this.#options.mySide,
      reduced: this.#options.reducedMotion,
      captured: extra.captured,
    });
    const busy = new Set<BattleSideId>();
    for (const cue of plan.acts) {
      busy.add(cue.side);
      this.#rigs[cue.side].queue.push({ ...cue, delay: now + cue.delay });
    }
    if (step.kind === 'swap' && extra.incoming) {
      const out = step.to !== null && step.to !== step.slot;
      this.#rigs[step.side].incoming = {
        ...extra.incoming,
        at: now + (out ? step.ms * CHOREO.swap.out : 0),
      };
    }
    // Anyone left away from home by an earlier step (a dash that didn't
    // land) hops back; tuckered-out and swapped-out squishies stay put.
    for (const rig of Object.values(this.#rigs)) {
      if (busy.has(rig.side) || !rig.act) continue;
      if (ACT_END[rig.act.kind] === 'contact') {
        rig.queue.push({
          side: rig.side,
          kind: 'return',
          delay: now,
          ms: CHOREO.returnMs,
          strength: 1,
        });
      }
    }
    this.#advance(now);
    for (const cue of plan.squish) {
      this.play(cue.side, cue.move, now + cue.delay, cue.strength);
    }
    for (const cue of plan.effects) {
      const rig = this.#rigs[cue.side];
      const them = this.#rigs[other(cue.side)];
      const at = this.#centre(rig);
      let to: Point | undefined;
      let path: ((t: number) => Point) | undefined;
      let duration: number | undefined;
      if (cue.kind === 'bolt') to = this.#centre(them);
      if (cue.kind === 'charm') {
        // Thrown from the player's Keeper (or their squishy) at the wild one's feet.
        const keeper = this.#keeper ? this.#keepers.centre(this.#keeper) : null;
        to = keeper ? { x: keeper.x, y: keeper.y, z: keeper.z } : this.#centre(them);
        at.y = 0.35;
        duration = step.ms * CHOREO.charm.resultAt + 80;
      }
      if (cue.kind === 'trail') {
        // The dash this step started (already running), or one still queued.
        const queued = rig.queue.find((q) => q.kind === 'dash');
        const dash =
          rig.act?.kind === 'dash' && rig.act.start >= now
            ? rig.act
            : queued
              ? this.#act(rig, 'dash', queued.delay, queued.ms, 1, rig.pose)
              : null;
        path = (t) => this.#centreAt(rig, dash ? actPose(dash, t) : rig.pose);
        duration = cue.strength * 1000;
      }
      this.#effects.spawn(
        emit(
          {
            kind: cue.kind,
            element: cue.element,
            strength: cue.kind === 'trail' ? 1 : cue.strength,
            now: now + cue.delay,
            at,
            height: rig.height,
            to,
            path,
            duration,
            dust: this.#dust,
            share: this.#options.reducedMotion ? 0.6 : this.#lod === 'low' ? 0.7 : 1,
          },
          this.#salt++,
        ),
      );
    }
    this.#director.cue(plan.camera, now);
    return plan;
  }

  /** The turn is over: the camera frames both fighters again. */
  restCamera(): void {
    this.#director.rest();
  }

  /** Advances everything to `now`; true while anything moves (keep drawing). */
  update(now: number): boolean {
    this.#now = now;
    this.#hookCamera();
    this.#advance(now);
    let moving = false;
    for (const rig of Object.values(this.#rigs)) {
      if (rig.incoming && now >= rig.incoming.at) {
        const { speciesId, instanceId } = rig.incoming;
        const act = rig.act;
        this.sendOut(rig.side, speciesId, instanceId);
        rig.act = act; // keeps the swap-in that is dropping it in
      }
      this.#apply(rig, this.#layered(rig, now));
      if (actRunning(rig.act, now) || rig.queue.length > 0 || rig.incoming) moving = true;
    }
    this.#writeShadows();
    const effects = this.#effects.update(now);
    const keeper = this.#keepers.update(now);
    const a = this.#rigs.a.field.update(now);
    const b = this.#rigs.b.field.update(now);
    // Idle, the ready stance bounces too (not with reduced motion).
    const idle = !this.#options.reducedMotion;
    return moving || effects || keeper || a || b || idle || this.#director.moving(now);
  }

  /** True while a move, an effect or the camera is moving (draw every frame, not just breathing). */
  isPlaying(now: number): boolean {
    for (const rig of Object.values(this.#rigs)) {
      if (actRunning(rig.act, now) || rig.queue.length > 0 || rig.incoming) return true;
      if (rig.handle && rig.field.isPlaying(rig.handle, now)) return true;
    }
    if (this.#effects.stats.live > 0) return true;
    if (this.#director.moving(now)) return true;
    return this.#keeper !== null && this.#keepers.isPlaying(this.#keeper, now);
  }

  setLod(lod: SquishyLod): void {
    if (lod === this.#lod) return;
    this.#lod = lod;
    this.#rigs.a.field.setLod(lod);
    this.#rigs.b.field.setLod(lod);
    this.#keepers.setLod(lod);
    // A new detail level drops every mesh: build the benches again now, not at the next swap.
    for (const [side, team] of this.#teams) this.prewarm(side, team);
  }

  get stats(): BattleSceneStats {
    const a = this.#rigs.a.field.stats;
    const b = this.#rigs.b.field.stats;
    return {
      squishies: a.squishies + b.squishies,
      meshes: a.meshes + b.meshes,
      instances: a.instances + b.instances,
      shadowLook: a.shadowLook + b.shadowLook,
      lod: this.#lod,
      keeper: this.#keeper !== null,
      arena: this.#arena.stats,
      effects: this.#effects.stats,
      acts: this.#acts,
      down: Object.values(this.#rigs).filter((r) => this.#isDown(r)).length,
      reducedMotion: this.#options.reducedMotion,
    };
  }

  get hasKeeper(): boolean {
    return this.#keeper !== null;
  }

  dispose(): void {
    if (this.#cameraHook) this.#scene.onBeforeRenderObservable.remove(this.#cameraHook);
    this.#effects.dispose();
    this.#keepers.dispose();
    for (const rig of Object.values(this.#rigs)) {
      rig.field.dispose();
      rig.root.dispose();
    }
    this.#shadows.material?.dispose(true, true);
    this.#shadows.dispose();
    this.#arena.dispose();
  }

  // ── Internals ────────────────────────────────────────────────────────

  #act(rig: Rig, kind: Act['kind'], start: number, ms: number, strength: number, from: Pose): Act {
    const other = this.#rigs[rig.side === 'a' ? 'b' : 'a'];
    const gap = Math.hypot(other.home.x - rig.home.x, other.home.z - rig.home.z);
    // Arm's length: just touching, so the hit lands on the other squishy's face.
    const reach = Math.max(0.4, gap - rig.radius - other.radius - 0.05);
    return { kind, start, ms, from, reach, strength, reduced: this.#options.reducedMotion };
  }

  /** Starts queued acts whose time has come, each from the pose it finds the fighter in. */
  #advance(now: number): void {
    for (const rig of Object.values(this.#rigs)) {
      rig.queue.sort((x, y) => x.delay - y.delay);
      while (rig.queue.length > 0 && (rig.queue[0]?.delay ?? Infinity) <= now) {
        const cue = rig.queue.shift();
        if (!cue) break;
        const from = actPose(rig.act, cue.delay);
        rig.act = this.#act(rig, cue.kind, cue.delay, cue.ms, cue.strength, from);
        this.#acts += 1;
      }
    }
  }

  /** The act's pose, on top of the ready stance while the squishy is up. */
  #layered(rig: Rig, now: number): Pose {
    const p = actPose(rig.act, now);
    const end = rig.act ? ACT_END[rig.act.kind] : 'home';
    if (end === 'down' || end === 'gone' || end === 'small') return p;
    const ready = readyPose(now, rig.phase, this.#options.reducedMotion);
    return {
      ...p,
      lean: p.lean + ready.lean,
      squash: p.squash * ready.squash,
      lift: p.lift + (actRunning(rig.act, now) ? 0 : ready.lift),
      side: p.side + ready.side,
    };
  }

  #isDown(rig: Rig): boolean {
    return rig.act !== null && ACT_END[rig.act.kind] === 'down' && rig.queue.length === 0;
  }

  /** Moves the rig's nodes to a pose (no allocation: the nodes' own vectors are set). */
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
    // Squash keeps the volume: wider when flatter, thinner when stretched.
    const width = 1 / Math.sqrt(Math.max(0.2, p.squash * p.stretch));
    const s = Math.max(0, p.scale);
    rig.tilt.scaling.set(width * s, p.squash * s, width * p.stretch * s);
    rig.turn.rotation.y = rig.yaw + p.spin;
  }

  /** The middle of a fighter as it is now. */
  #centre(rig: Rig): { x: number; y: number; z: number } {
    return this.#centreAt(rig, rig.pose);
  }

  #centreAt(rig: Rig, p: Pose): { x: number; y: number; z: number } {
    return {
      x: rig.home.x + rig.fx * p.forward + rig.fz * p.side,
      y: Math.max(0.2, p.lift + (rig.height * p.squash * p.scale) / 2),
      z: rig.home.z + rig.fz * p.forward - rig.fx * p.side,
    };
  }

  #writeShadows(): void {
    let i = 0;
    for (const rig of Object.values(this.#rigs)) {
      const p = rig.pose;
      const lifted = Math.max(0.35, 1 - Math.max(0, p.lift) / (rig.height * 1.2));
      const d = rig.handle ? rig.radius * 2 * CONTACT_SHADOW.scale * p.scale * lifted : 0;
      const o = i * 16;
      const m = this.#shadowMatrices;
      m.fill(0, o, o + 16);
      m[o] = d;
      m[o + 5] = 1;
      m[o + 10] = d;
      m[o + 12] = rig.root.position.x;
      m[o + 13] = 0.015;
      m[o + 14] = rig.root.position.z;
      m[o + 15] = 1;
      i++;
    }
    this.#shadows.thinInstanceBufferUpdated('matrix');
  }

  /** Poses the stage camera before every frame, after the map camera's own handler. */
  #hookCamera(): void {
    if (this.#cameraHook) return;
    const scene = this.#scene;
    this.#cameraHook = scene.onBeforeRenderObservable.add(() => {
      const camera = scene.activeCamera;
      if (!(camera instanceof TargetCamera)) return;
      const engine = scene.getEngine();
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      const shot = this.#director.shot(this.#now, aspect);
      camera.fov = shot.fov;
      camera.minZ = BATTLE_CAMERA.minZ;
      camera.maxZ = ARENA_STAGE.skyRadius * 2.5;
      camera.position.set(shot.position.x, shot.position.y, shot.position.z);
      camera.setTarget(this.#lookAt.set(shot.target.x, shot.target.y, shot.target.z));
      // The lens shift: Babylon's own projection for this frame, moved up.
      camera.unfreezeProjectionMatrix();
      this.#projection.copyFrom(camera.getProjectionMatrix(true));
      this.#projection.addAtIndex(9, shot.shift);
      camera.freezeProjectionMatrix(this.#projection);
    });
  }
}

const other = (side: BattleSideId): BattleSideId => (side === 'a' ? 'b' : 'a');
