import { Animation } from '@babylonjs/core/Animations/animation';
import '@babylonjs/core/Animations/animatable';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  hexToWorld,
  worldToHex,
  type Hex,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { HEX_SIZE, TERRAIN_LOOKS } from '../map/map-config.js';
import type { MapLayer } from '../map/map-screen.js';
import { HollowMan } from '../procedural/hollow-man/hollow-man.js';
import { NIGHT_LOOK, SHOW, VISIT_SPOT } from './hollow-config.js';
import type { Beat, BeatKind } from './show-timeline.js';

// Night on the map and the Hollow Man's visit (#21, design doc §14). The
// layer dims the open map's light while it's night (map time, from the
// server) and plays his visit when night falls live. Render on demand (tech
// spec §6): changing the light draws a few frames; only the visit's own
// animation keeps the map drawing, for its ~4.5 s.
//
// The night show (#277) walks one Hollow Man per Keeper along their border:
// each stop is a short move (a glide, then a lean towards a lit tile and back
// with his eyes flaring, or a reach for a dark one), driven by one Babylon
// animation so the stage draws only while it plays. Between stops he stands
// still, which draws nothing. Three draw calls per Keeper he walks for, only
// while he's out.

/** A point on the ground plane (world units). */
interface Ground {
  x: number;
  z: number;
}

/** How he stands at one moment of a stop. */
export interface WalkPose extends Ground {
  alpha: number;
  reach: number;
  flare: number;
}

/**
 * Where he stands for a stop at `h`: just outside it, away from the Keeper's
 * Heart Seed (`seed`), so he's on the dark side of their border.
 */
export function standOf(h: Hex, seed: Hex | null): Ground {
  const p = hexToWorld(h, HEX_SIZE);
  const s = seed ? hexToWorld(seed, HEX_SIZE) : { x: p.x, z: p.z - 1 };
  const dx = p.x - s.x;
  const dz = p.z - s.z;
  const len = Math.hypot(dx, dz) || 1;
  const off = SHOW.standOff * HEX_SIZE * Math.sqrt(3);
  return { x: p.x + (dx / len) * off, z: p.z + (dz / len) * off };
}

const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** 0 → 1 over [a, b]. */
const span = (p: number, a: number, b: number): number => ease((p - a) / (b - a));
/** Up and back down over [a, b], peaking at its middle. */
const bump = (p: number, a: number, b: number): number =>
  p <= a || p >= b ? 0 : Math.sin(((p - a) / (b - a)) * Math.PI);
const lerp = (a: Ground, b: Ground, t: number): Ground => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

/**
 * His pose `p` (0–1) of the way through a stop: from `from` (where he
 * waited) to `stand` (outside tile `tile`). At a lit tile he leans in and
 * slides back, eyes flaring; at a dark one he reaches; entering he fades in
 * and leaving he fades out. Reduced motion: his eyes never flare.
 */
export function stepPose(
  kind: BeatKind,
  p: number,
  from: Ground,
  stand: Ground,
  tile: Ground,
  reduced: boolean,
): WalkPose {
  const rest = SHOW.waitAlpha;
  switch (kind) {
    case 'enter':
      return { ...stand, alpha: rest * span(p, 0, 1), reach: 0, flare: 0 };
    case 'leave':
      return { ...stand, alpha: rest * (1 - span(p, 0, 1)), reach: 0, flare: 0 };
    case 'recoil': {
      const at = lerp(from, stand, span(p, 0, 0.45));
      const lean = SHOW.lean * bump(p, 0.45, 1);
      return {
        ...lerp(at, tile, lean / SHOW.standOff),
        alpha: rest + (1 - rest) * bump(p, 0.3, 1),
        reach: 0.25 * bump(p, 0.45, 0.85),
        flare: reduced ? 0 : bump(p, 0.5, 0.85),
      };
    }
    case 'strike': {
      const at = lerp(from, stand, span(p, 0, 0.4));
      const reach = bump(p, 0.4, 1);
      return {
        ...lerp(at, tile, (SHOW.lean * reach) / SHOW.standOff),
        alpha: rest + (1 - rest) * bump(p, 0.3, 1),
        reach,
        flare: reduced ? 0 : reach,
      };
    }
  }
}

/** One Keeper's Hollow Man on the walk. */
interface Walker {
  readonly man: HollowMan;
  /** Where he waits now (the end of his last stop). */
  at: Ground;
  /** The stop playing: its start, what it does, from where, to where. */
  step: {
    kind: BeatKind;
    from: Ground;
    stand: Ground;
    tile: Ground;
    clock: { p: number };
    done: (() => void) | null;
  } | null;
}

/** What the day looked like, kept so morning puts it back exactly. */
interface DayLight {
  clear: Color4;
  environment: number;
  sun: { intensity: number; diffuse: Color3 } | null;
}

export interface HollowLayerDebug {
  readonly night: boolean;
  readonly visiting: boolean;
  /** Visits played since the page loaded. */
  readonly visits: number;
  /** Keepers he's out walking for on the open map now (#277). */
  readonly walking: number;
  /** Walk stops played since the page loaded (#277). */
  readonly steps: number;
}

export class HollowLayer implements MapLayer {
  private scene: Scene | null = null;
  private day: DayLight | null = null;
  private man: HollowMan | null = null;
  private tiles = new Map<string, PublicTile>();
  private night = false;
  private visits = 0;
  private steps = 0;
  private readonly walkers = new Map<string, Walker>();
  /** The playing visit's `done`, so a scene torn down mid-visit (GPU loss) still ends it. */
  private pendingDone: (() => void) | null = null;
  private readonly invalidate: () => void;

  constructor(options: { invalidate: () => void }) {
    this.invalidate = options.invalidate;
  }

  attach(scene: Scene, view: MapView): void {
    this.scene = scene;
    const sun = scene.getLightByName('sun');
    this.day = {
      clear: scene.clearColor.clone(),
      environment: scene.environmentIntensity,
      sun: sun ? { intensity: sun.intensity, diffuse: sun.diffuse.clone() } : null,
    };
    this.tiles = new Map(view.tiles.map((t) => [hexKey(t), t]));
    scene.onBeforeRenderObservable.add(() => {
      this.poseWalkers();
    });
    const man = new HollowMan(scene);
    this.man = man;
    scene.onDisposeObservable.addOnce(() => {
      if (this.scene !== scene) return;
      const done = this.pendingDone;
      this.pendingDone = null;
      done?.();
      for (const walker of this.walkers.values()) walker.step?.done?.();
      this.walkers.clear();
      this.scene = null;
      this.man = null;
      this.day = null;
      this.tiles = new Map();
    });
    this.apply();
  }

  /** Night or day on the open map (and any map opened later). */
  setNight(night: boolean): void {
    if (this.night === night) return;
    this.night = night;
    this.apply();
    this.invalidate();
  }

  /**
   * Night just fell: he visits the open map once, where the player is
   * looking (a little up-screen, clear of the bottom cards), and `done` is
   * called when he has faded away. False (and no `done`) if no map is drawn.
   */
  visit(done?: () => void): boolean {
    const { man, scene } = this;
    if (!man || !scene) return false;
    if (man.isVisiting) return true;
    this.visits += 1;
    this.pendingDone = done ?? null;
    man.visit(this.spotNear(scene), () => {
      this.pendingDone = null;
      this.invalidate();
      done?.();
    });
    this.invalidate();
    return true;
  }

  /** The map redrew: his stops stand on the tiles as they are now. */
  update(view: MapView): void {
    this.tiles = new Map(view.tiles.map((t) => [hexKey(t), t]));
  }

  /**
   * One stop of `keeper`'s walk (#277). `still` stands him where the stop
   * ends at once (joining a show part way, or reduced motion's enter);
   * otherwise it plays and `done` is called when it has. False (and no
   * `done`) if no map is drawn.
   */
  walk(
    keeper: string,
    beat: Pick<Beat, 'kind' | 'q' | 'r'>,
    seed: Hex | null,
    still: boolean,
    done?: () => void,
  ): boolean {
    const scene = this.scene;
    if (!scene) return false;
    let walker = this.walkers.get(keeper);
    const stand = standOf(beat, seed);
    if (!walker) {
      walker = { man: new HollowMan(scene), at: stand, step: null };
      this.walkers.set(keeper, walker);
    }
    // A stop still playing finishes where it was going first.
    if (walker.step) {
      walker.at = walker.step.stand;
      const previous = walker.step.done;
      walker.step = null;
      previous?.();
    }
    this.steps += 1;
    const tile = hexToWorld(beat, HEX_SIZE);
    if (still) {
      walker.at = stand;
      this.stand(walker.man, beat.kind === 'leave' ? 0 : SHOW.waitAlpha, stand);
      if (beat.kind === 'leave') this.dropWalker(keeper);
      this.invalidate();
      done?.();
      return true;
    }
    const clock = { p: 0 };
    const step = { kind: beat.kind, from: walker.at, stand, tile, clock, done: done ?? null };
    walker.step = step;
    const frames = Math.round((SHOW.moveMs / 1000) * 30);
    const animation = new Animation('hollow-walk', 'p', 30, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([
      { frame: 0, value: 0 },
      { frame: frames, value: 1 },
    ]);
    scene.beginDirectAnimation(clock, [animation], 0, frames, false, 1, () => {
      const current = this.walkers.get(keeper);
      if (current?.step !== step) return;
      clock.p = 1;
      this.poseWalkers();
      current.at = stand;
      current.step = null;
      if (beat.kind === 'leave') this.dropWalker(keeper);
      this.invalidate();
      step.done?.();
    });
    this.invalidate();
    return true;
  }

  /** Every walk ends now: he's gone from the map. */
  endWalks(): void {
    for (const keeper of [...this.walkers.keys()]) {
      const walker = this.walkers.get(keeper);
      const done = walker?.step?.done;
      if (walker) walker.step = null;
      this.dropWalker(keeper);
      done?.();
    }
    this.invalidate();
  }

  private dropWalker(keeper: string): void {
    const walker = this.walkers.get(keeper);
    if (!walker) return;
    this.walkers.delete(keeper);
    walker.man.dispose();
  }

  /** Each walking Hollow Man's pose for this frame. */
  private poseWalkers(): void {
    const reduced = reducedMotion();
    for (const walker of this.walkers.values()) {
      const step = walker.step;
      if (!step) continue;
      const pose = stepPose(step.kind, step.clock.p, step.from, step.stand, step.tile, reduced);
      walker.man.pose(
        { x: pose.x, y: this.groundAt(pose), z: pose.z },
        pose.alpha,
        SHOW.scale,
        pose.reach,
        pose.flare,
      );
    }
  }

  private stand(man: HollowMan, alpha: number, at: Ground): void {
    man.pose({ x: at.x, y: this.groundAt(at), z: at.z }, alpha, SHOW.scale);
  }

  /** The ground's height under a point: its tile's top, or 0 off the map. */
  private groundAt(at: Ground): number {
    const tile = this.tiles.get(hexKey(worldToHex(at, HEX_SIZE)));
    return tile ? (TERRAIN_LOOKS[tile.terrain]?.height ?? 0) : 0;
  }

  /** A spot just up-screen of what the camera looks at, standing on its tile. */
  private spotNear(scene: Scene): { x: number; y: number; z: number } {
    const camera = scene.activeCamera;
    const target = camera instanceof TargetCamera ? camera.getTarget() : null;
    const x = (target?.x ?? 0) + VISIT_SPOT.x;
    const z = (target?.z ?? 0) + VISIT_SPOT.z;
    const tile = this.tiles.get(hexKey(worldToHex({ x, z }, HEX_SIZE)));
    const y = tile ? (TERRAIN_LOOKS[tile.terrain]?.height ?? 0) : 0;
    return { x, y, z };
  }

  get debug(): HollowLayerDebug {
    return {
      night: this.night,
      visiting: this.man?.isVisiting ?? false,
      visits: this.visits,
      walking: this.walkers.size,
      steps: this.steps,
    };
  }

  private apply(): void {
    const { scene, day } = this;
    if (!scene || !day) return;
    const sun = scene.getLightByName('sun');
    if (this.night) {
      scene.clearColor = Color4.FromHexString(`${NIGHT_LOOK.clear}ff`);
      scene.environmentIntensity = day.environment * NIGHT_LOOK.environment;
      if (sun && day.sun) {
        sun.intensity = day.sun.intensity * NIGHT_LOOK.sun;
        sun.diffuse = new Color3(...NIGHT_LOOK.moon);
      }
    } else {
      scene.clearColor = day.clear.clone();
      scene.environmentIntensity = day.environment;
      if (sun && day.sun) {
        sun.intensity = day.sun.intensity;
        sun.diffuse = day.sun.diffuse.clone();
      }
    }
  }
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
