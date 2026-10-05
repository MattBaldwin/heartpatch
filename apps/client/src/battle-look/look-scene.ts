import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { GAME_DATA, KEEPER_DATA, type FeelingId, type Species, type VisualRegistry } from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { CONTACT_SHADOW, type SquishyLod } from '../procedural/config.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { poseFor, REST, type ActContext, type Pose } from './choreo.js';
import type { Direction } from './directions.js';
import { buildArena, HOMES, type Arena } from './look-arena.js';
import { applyShot, computeShot, NO_BEAT, type Beat, type FitPoint, type SafeRegion, type Shot as CameraShot } from './look-camera.js';
import { emit, FxPool, type Cue, type Particle, type Point } from './look-fx.js';
import { ATTACK, CHARM, KO, type Shot } from './shots.js';

/*
 * One battle moment, drawn three ways: the arena, two real squishies on rigs
 * (choreo.ts poses them), the player's Keeper, the effect pool, and the
 * direction's camera. Time is an input (`setTime`), so a frozen frame is
 * exact and play mode just advances it.
 */

export interface LookStats {
  drawCalls: number;
  activeMeshes: number;
  arenaMeshes: number;
  props: number;
  fxLive: number;
  fxMeshes: number;
  squishyMeshes: number;
  shadows: 'map' | 'contact';
  shadowCasters: number;
}

interface Rig {
  readonly role: 'player' | 'foe';
  readonly root: TransformNode;
  readonly tilt: TransformNode;
  readonly turn: TransformNode;
  readonly field: SquishyField;
  readonly home: { x: number; z: number };
  readonly fx: number;
  readonly fz: number;
  readonly yaw: number;
  readonly species: Species;
  handle: SquishyHandle;
  height: number;
  radius: number;
  pose: Pose;
}

interface ScheduledCue {
  at: number;
  cue: Cue;
  who: 'player' | 'foe';
  spawned: boolean;
  duration?: number;
}

const SCALE = 2.7;

export class LookScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #shot: Shot;
  readonly #dir: Direction;
  readonly #reduced: boolean;
  readonly #arena: Arena;
  readonly #rigs: Record<'player' | 'foe', Rig>;
  readonly #keepers: KeeperField;
  readonly #keeper: KeeperHandle;
  readonly #fx: FxPool;
  readonly #shadows: Mesh;
  readonly #shadowMatrices = new Float32Array(64);
  #fit: FitPoint[] = [];
  readonly #cues: ScheduledCue[] = [];
  readonly #cameraShot: CameraShot = {
    position: new Vector3(),
    target: new Vector3(),
    up: new Vector3(0, 1, 0),
    fov: 0.75,
    shift: 0,
    distance: 20,
  };
  readonly #instrumentation: SceneInstrumentation;
  #hook: Observer<Scene> | null = null;
  #safe: () => SafeRegion;
  #now = 0;
  #beat: Beat = NO_BEAT;
  #salt = 1;
  #drawCalls = 0;
  #lastCueTime = -1;

  constructor(
    scene: Scene,
    options: {
      shot: Shot;
      direction: Direction;
      registry: VisualRegistry;
      lod: SquishyLod;
      reduced: boolean;
      safe: () => SafeRegion;
    },
  ) {
    this.#scene = scene;
    this.#shot = options.shot;
    this.#dir = options.direction;
    this.#reduced = options.reduced;
    this.#safe = options.safe;
    this.#instrumentation = new SceneInstrumentation(scene);
    this.#arena = buildArena(scene, {
      terrain: options.shot.terrain,
      timeOfDay: options.shot.timeOfDay,
      direction: options.direction,
      seed: 7 + options.shot.id.length,
    });

    const species = (id: string): Species => {
      const s = GAME_DATA.species.find((x) => x.id === id);
      if (!s) throw new Error(`unknown species ${id}`);
      return s;
    };
    this.#rigs = {
      player: this.#rig('player', species(options.shot.player.speciesId), options.shot.player.instanceId, options),
      foe: this.#rig('foe', species(options.shot.foe.speciesId), options.shot.foe.instanceId, options),
    };

    // The player's Keeper, at their back like a coach.
    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    const place = KEEPER_PLACES.battle;
    this.#keeper = this.#keepers.add(
      { base: 'pip', hairColor: 'honey', eyeColor: 'cocoa', outfit: 'strawberry' },
      {
        // Behind the player's squishy (design doc §23), seen in the gap between the fighters.
        x: HOMES.player.x + 1.25,
        z: HOMES.player.z + 3.4,
        yaw: -0.25,
        lean: place.lean * 0.3,
        scale: place.scale,
      },
    );

    // Fighter contact shadows (stretched along the key light for long-shadow looks).
    this.#shadows = createContactShadowMesh(scene);
    this.#shadows.name = 'look-fighter-shadows';
    this.#shadows.thinInstanceSetBuffer('matrix', this.#shadowMatrices, 16, false);
    this.#shadows.alwaysSelectAsActiveMesh = true;

    this.#fx = new FxPool(scene, options.direction.fx.style === 'glow');

    // Soft shadow map: every squishy mesh casts (built now, so the meshes exist).
    if (this.#arena.shadows) {
      for (const rig of Object.values(this.#rigs)) rig.field.flush();
      this.#keepers.flush();
      for (const m of scene.meshes) {
        if (m.name.startsWith('squishy-') || m.name.startsWith('keeper-')) {
          if (m.name.includes('shadow')) continue;
          this.#arena.shadows.addShadowCaster(m, false);
        }
      }
    }

    this.#fit = this.#fitPoints();
    this.#schedule();
    this.setTime(0);
    this.content = { bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 }, start: { x: 0, z: 0 } };
  }

  #rig(
    role: 'player' | 'foe',
    species: Species,
    instanceId: string,
    options: { registry: VisualRegistry; lod: SquishyLod; reduced: boolean },
  ): Rig {
    const scene = this.#scene;
    const home = HOMES[role];
    const other = HOMES[role === 'player' ? 'foe' : 'player'];
    const dx = other.x - home.x;
    const dz = other.z - home.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const root = new TransformNode(`look-rig-${role}`, scene);
    const tilt = new TransformNode(`look-rig-${role}-tilt`, scene);
    const turn = new TransformNode(`look-rig-${role}-turn`, scene);
    tilt.parent = root;
    turn.parent = tilt;
    root.position.set(home.x, 0, home.z);
    const facing = Math.atan2(fx, fz); // local +z points at the other fighter
    root.rotation.y = facing;
    // Three-quarter: the face turns between "at the other" and "at the camera".
    const toCam = { x: 0, z: -1 };
    const k = role === 'player' ? 0.5 : 0.62;
    const wx = fx * k + toCam.x * (1 - k);
    const wz = fz * k + toCam.z * (1 - k);
    const worldYaw = Math.atan2(-wx, -wz);
    const yaw = worldYaw - facing;
    const field = new SquishyField(scene, {
      registry: options.registry,
      lod: options.lod,
      shadows: false,
      parent: turn,
      breathing: !options.reduced,
    });
    // The rig's turn node carries the yaw (passing it to the field too would turn it twice).
    const handle = field.add(species, instanceId, { x: 0, z: 0, yaw: 0, scale: SCALE });
    const body = options.registry.bodies.get(handle.params.body.id);
    const [sx, , sz] = handle.params.body.scale;
    return {
      role,
      root,
      tilt,
      turn,
      field,
      home,
      fx,
      fz,
      yaw,
      species,
      handle,
      height: handle.params.height * SCALE,
      radius: (Math.max((body?.width ?? 1) * sx, (body?.depth ?? 1) * sz) * SCALE) / 2,
      pose: REST,
    };
  }

  /** What the camera must keep on screen: both fighters, squashed wide, and the target's knockback. */
  #fitPoints(): FitPoint[] {
    const out: FitPoint[] = [];
    const wide = 1.2; // a squash widens a squishy by up to 1/sqrt(0.7)
    const actor = this.#rigs[this.#shot.actor];
    for (const rig of Object.values(this.#rigs)) {
      const r = rig.radius * wide + 0.25;
      const h = rig.height * 1.25 + 0.3;
      out.push({ x: rig.home.x, z: rig.home.z, r, h });
      if (rig !== actor && this.#shot.sequence === 'attack') {
        const kb = this.#dir.motion.knockback * 1.2;
        out.push({ x: rig.home.x - rig.fx * kb, z: rig.home.z - rig.fz * kb, r, h });
      }
    }
    return out;
  }

  #ctx(rig: Rig): ActContext {
    const other = this.#rigs[rig.role === 'player' ? 'foe' : 'player'];
    const gap = Math.hypot(other.home.x - rig.home.x, other.home.z - rig.home.z);
    return {
      motion: this.#reduced ? { ...this.#dir.motion, idleBob: 0 } : this.#dir.motion,
      feeling: rig.species.feeling as FeelingId,
      reach: Math.max(0.4, gap - rig.radius - other.radius - 0.05),
      reduced: this.#reduced,
      strength: 1.2,
    };
  }

  /** The effect cues of this shot's sequence, in time order. */
  #schedule(): void {
    const s = this.#shot;
    const actor = s.actor;
    const target = actor === 'player' ? 'foe' : 'player';
    const add = (at: number, cue: Cue, who: 'player' | 'foe', duration?: number) =>
      this.#cues.push({ at, cue, who, spawned: false, duration });
    switch (s.sequence) {
      case 'attack': {
        add(120, 'charge', actor);
        add(ATTACK.windup, 'trail', actor, ATTACK.dashEnd - ATTACK.windup);
        add(ATTACK.dashEnd, 'impact', target);
        add(ATTACK.dashEnd + this.#dir.motion.hitStop, 'dizzy', target, 700);
        break;
      }
      case 'charm':
        add(0, 'charm', 'foe', CHARM.pop);
        add(CHARM.pop, 'charmPop', 'foe');
        break;
      case 'ko':
        add(KO.flop - 60, 'ko', actor);
        add(KO.flop, 'dizzy', actor, 1500);
        add(KO.twirl + 100, 'victory', target);
        break;
      case 'idle':
        break;
    }
  }

  /** Poses everything for battle time `t` (ms). */
  setTime(t: number): void {
    const s = this.#shot;
    if (t < this.#lastCueTime) {
      // Looped: start the sequence again.
      this.#fx.clear();
      for (const c of this.#cues) c.spawned = false;
    }
    this.#lastCueTime = t;
    this.#now = t;
    const actor = s.actor;
    // Fighters.
    for (const rig of Object.values(this.#rigs)) {
      const role = rig.role === actor ? 'actor' : 'target';
      const ctx = this.#ctx(rig);
      let pose = poseFor(s.sequence, role, t, ctx);
      // Idle personality rides under every sequence while the fighter is "up".
      if (s.sequence !== 'idle' && pose.scale === 1 && Math.abs(pose.roll) < 0.5) {
        const idle = poseFor('idle', role, t, ctx);
        pose = { ...pose, lift: pose.lift + idle.lift * 0.5, lean: pose.lean + idle.lean * 0.5, spin: pose.spin + idle.spin * 0.5 };
      }
      this.#apply(rig, pose);
    }
    // Squish shader clock (breathing) and the Keeper's cheers, on the same frozen clock.
    for (const rig of Object.values(this.#rigs)) {
      rig.field.update(0);
      rig.field.update(t);
    }
    this.#keepers.update(0);
    this.#keepers.update(t);
    if (!this.#reduced) this.#keeperCheer(t);
    this.#writeShadows();
    // Effects.
    for (const c of this.#cues) {
      if (c.spawned || c.at > t) continue;
      c.spawned = true;
      this.#fx.spawn(this.#emit(c));
    }
    this.#fx.update(t);
    this.#beat = this.#beatAt(t);
    this.#hookCamera();
  }

  #keeperCheer(t: number): void {
    const s = this.#shot;
    const cheerAt =
      s.sequence === 'attack' ? ATTACK.dashEnd + 120 : s.sequence === 'ko' ? KO.twirl : s.sequence === 'charm' ? CHARM.pop : -1;
    if (cheerAt >= 0 && t >= cheerAt && t < cheerAt + 1100) {
      // Replays deterministically: play at the cheer time on the frozen clock.
      this.#keepers.play(this.#keeper, 'bounce', cheerAt, 1);
      this.#keepers.update(t);
    }
  }

  #emit(c: ScheduledCue): Particle[] {
    const rig = this.#rigs[c.who];
    const other = this.#rigs[c.who === 'player' ? 'foe' : 'player'];
    const at = this.#centre(rig);
    let to: Point | undefined;
    let path: ((t: number) => Point) | undefined;
    if (c.cue === 'impact') {
      // The bonk lands on the target's near side, towards the attacker.
      at.x -= rig.fx * rig.radius * 0.55;
      at.z -= rig.fz * rig.radius * 0.55;
    }
    if (c.cue === 'dizzy' && this.#shot.sequence === 'ko') at.y = 0; // it's lying down
    if (c.cue === 'charm') {
      const k = this.#keepers.centre(this.#keeper);
      to = k ? { x: k.x, y: k.y + 0.3, z: k.z } : this.#centre(other);
    }
    if (c.cue === 'trail') {
      const ctx = this.#ctx(rig);
      path = (t) => this.#centreAt(rig, poseFor('attack', 'actor', t, ctx));
    }
    return emit({
      cue: c.cue,
      element: this.#shot.element,
      look: this.#dir.fx,
      reduced: this.#reduced,
      now: c.at,
      at,
      height: rig.height,
      to,
      path,
      duration: c.duration,
      strength: 1.2,
      salt: this.#salt++,
    });
  }

  #beatAt(t: number): Beat {
    const s = this.#shot;
    if (this.#reduced) return NO_BEAT;
    if (s.sequence === 'attack') {
      const actor = this.#rigs[s.actor].home;
      const target = this.#rigs[s.actor === 'player' ? 'foe' : 'player'].home;
      if (t < ATTACK.dashEnd) {
        const u = Math.min(1, t / ATTACK.windup);
        return { push: 0.35 * u, shake: 0, shakeAge: 0, roll: 0, focus: actor, focusAmount: 0.3 * u };
      }
      const age = t - ATTACK.dashEnd;
      const decay = Math.exp(-age / 420);
      return { push: 0.35 + 0.65 * decay, shake: 1, shakeAge: age, roll: decay, focus: target, focusAmount: 0.35 * decay };
    }
    if (s.sequence === 'ko' && t >= KO.flop) {
      const age = t - KO.flop;
      const decay = Math.exp(-age / 500);
      return { push: 0.5 * decay, shake: 0.6, shakeAge: age, roll: 0, focus: this.#rigs[s.actor].home, focusAmount: 0.3 };
    }
    if (s.sequence === 'charm') {
      return { push: 0.2, shake: 0, shakeAge: 0, roll: 0, focus: this.#rigs.foe.home, focusAmount: 0.3 };
    }
    return NO_BEAT;
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

  #centre(rig: Rig): Point {
    return this.#centreAt(rig, rig.pose);
  }

  #centreAt(rig: Rig, p: Pose): Point {
    return {
      x: rig.home.x + rig.fx * p.forward + rig.fz * p.side,
      y: Math.max(0.2, p.lift + (rig.height * p.squash * p.scale) / 2),
      z: rig.home.z + rig.fz * p.forward - rig.fx * p.side,
    };
  }

  #writeShadows(): void {
    const stretch = this.#dir.lights[this.#shot.timeOfDay].shadowStretch;
    const k = this.#arena.keyDir;
    // Shadows fall away from the light: along the key's horizontal direction.
    const ax = k.x;
    const az = k.z;
    const alen = Math.hypot(ax, az) || 1;
    const ux = ax / alen;
    const uz = az / alen;
    let i = 0;
    const m = this.#shadowMatrices;
    const writes: { rig: Rig; k: number }[] = [];
    for (const rig of Object.values(this.#rigs)) writes.push({ rig, k: 1 }, { rig, k: 0.72 });
    for (const { rig, k } of writes) {
      const p = rig.pose;
      const lifted = Math.max(0.35, 1 - Math.max(0, p.lift) / (rig.height * 1.2));
      const d = rig.radius * 2 * CONTACT_SHADOW.scale * p.scale * lifted * k;
      const o = i * 16;
      // Rows: x axis (across the light), z axis (along it, stretched), translation offset along it.
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
      i++;
    }
    this.#shadows.thinInstanceBufferUpdated('matrix');
  }

  #hookCamera(): void {
    if (this.#hook) return;
    const scene = this.#scene;
    this.#hook = scene.onBeforeRenderObservable.add(() => {
      const camera = scene.activeCamera;
      if (!(camera instanceof TargetCamera)) return;
      const engine = scene.getEngine();
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      const shot = computeShot(this.#dir.camera, aspect, this.#safe(), this.#beat, this.#fit, this.#cameraShot);
      applyShot(camera, shot, 0.3, 300);
      // Billboarded effects (speed lines, rays) need the camera's basis.
      const fwd = shot.target.subtract(shot.position).normalize();
      const right = Vector3.Cross(shot.up, fwd).normalize();
      const up = Vector3.Cross(fwd, right).normalize();
      this.#fx.setCamera(right, up, fwd);
    });
    scene.onAfterRenderObservable.add(() => {
      this.#drawCalls = this.#instrumentation.drawCallsCounter.current;
    });
  }

  /** Dev check: where each face points in the world (expected vs. the rig's own answer). */
  debugFacing(): Record<string, { want: number; faceX: number; faceZ: number }> {
    const out: Record<string, { want: number; faceX: number; faceZ: number }> = {};
    for (const rig of Object.values(this.#rigs)) {
      rig.turn.computeWorldMatrix(true);
      const f = rig.turn.getDirection(new Vector3(0, 0, -1));
      out[rig.role] = { want: rig.yaw + rig.root.rotation.y, faceX: f.x, faceZ: f.z };
    }
    return out;
  }

  /** Fighter info for the HUD. */
  fighters(): { player: Species; foe: Species } {
    return { player: this.#rigs.player.species, foe: this.#rigs.foe.species };
  }

  get stats(): LookStats {
    const a = this.#rigs.player.field.stats;
    const b = this.#rigs.foe.field.stats;
    return {
      drawCalls: this.#drawCalls,
      activeMeshes: this.#scene.getActiveMeshes().length,
      arenaMeshes: this.#arena.stats.meshes,
      props: this.#arena.stats.props,
      fxLive: this.#fx.stats.live,
      fxMeshes: this.#fx.stats.meshes,
      squishyMeshes: a.meshes + b.meshes,
      shadows: this.#arena.shadows ? 'map' : 'contact',
      shadowCasters: this.#arena.shadows?.getShadowMap()?.renderList?.length ?? 0,
    };
  }

  dispose(): void {
    if (this.#hook) this.#scene.onBeforeRenderObservable.remove(this.#hook);
    this.#fx.dispose();
    this.#keepers.dispose();
    for (const rig of Object.values(this.#rigs)) {
      rig.field.dispose();
      rig.root.dispose();
    }
    this.#shadows.material?.dispose(true, true);
    this.#shadows.dispose();
    this.#arena.dispose();
    this.#instrumentation.dispose();
  }
}
