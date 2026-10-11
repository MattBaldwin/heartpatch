import type { QualityTier } from '../engine/config.js';
import { EXPLORE_SWIM } from './explore-config.js';

// Swimming under a lake (#399, "Glide and kick"): the Keeper and the team
// swim instead of hopping. Like the hop (#317), the stroke follows the water
// covered, never the clock, so a gentle push swims slowly and a full push
// kicks fast. Each swimmer's state is one small object updated in place, and
// the pose is written into a caller's object, so stepping allocates nothing.

export interface Swim {
  /** Strokes taken; the fraction is how far through the current one (0 is the kick). */
  phase: number;
  /** 0 (small, slow strokes) to 1 (long, strong strokes), eased toward the stick. */
  effort: number;
  /** 0 treading water upright, 1 stretched out swimming, eased. */
  stretch: number;
  /** Kicks started (whole strokes passed): a new one puffs bubbles. */
  kicks: number;
  moving: boolean;
  /** Extra phase, in strokes, so the team never kicks together. */
  readonly offset: number;
}

export interface SwimPose {
  /** Forward pitch, radians (positive tips the head forward, toward the heading). */
  pitch: number;
  /** Lift above the floor point, share of the swimmer's height (float plus bob). */
  lift: number;
  /** Length scale along the body (1 is none); the width keeps the volume. */
  squash: number;
  /** Ahead of the true point along the heading, share of the height (the surge). */
  surge: number;
}

export function createSwim(offset = 0): Swim {
  return { phase: offset, effort: 0, stretch: 0, kicks: 0, moving: false, offset };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const TAU = Math.PI * 2;

/** The water covered by one stroke at this effort, tile-local. */
export function strokeAt(effort: number): number {
  const { min, max } = EXPLORE_SWIM.stroke;
  return min + (max - min) * effort;
}

/** Still swimming or easing between treading and swimming: keep drawing. */
export function swimActive(swim: Swim): boolean {
  return swim.moving || swim.stretch > 0;
}

/**
 * One frame: `ds` is the water covered (tile-local), `dt` seconds, `push`
 * the stick's push (0–1). True when this frame started a new kick.
 */
export function stepSwim(swim: Swim, ds: number, dt: number, push: number): boolean {
  const moving = ds > 0;
  swim.moving = moving;
  if (dt > 0) {
    const goal = moving ? 1 : 0;
    const ease = moving ? EXPLORE_SWIM.stretchIn : EXPLORE_SWIM.stretchOut;
    swim.stretch += (goal - swim.stretch) * (1 - Math.exp(-dt / ease));
    if (!moving && swim.stretch < 0.002) swim.stretch = 0;
  }
  if (!moving) {
    if (dt > 0) swim.effort += (0 - swim.effort) * (1 - Math.exp(-dt / EXPLORE_SWIM.effortEase));
    return false;
  }
  if (dt > 0) {
    swim.effort += (clamp01(push) - swim.effort) * (1 - Math.exp(-dt / EXPLORE_SWIM.effortEase));
  }
  const before = Math.floor(swim.phase);
  swim.phase += ds / strokeAt(swim.effort);
  const after = Math.floor(swim.phase);
  if (after > before) {
    swim.kicks += after - before;
    return true;
  }
  return false;
}

/**
 * The pose this frame into `out` (no allocation). `time` is the water's
 * clock, seconds (the tread-water bob). With Reduce Motion: a still float,
 * leaning into the swim without kick, surge or bob.
 */
export function swimPose(swim: Swim, reduce: boolean, time: number, out: SwimPose): SwimPose {
  const s = swim.stretch;
  out.pitch = EXPLORE_SWIM.pitch * s;
  out.lift = EXPLORE_SWIM.float;
  out.squash = 1;
  out.surge = 0;
  if (reduce) return out;
  // Treading water: a slow bob that fades out as the swim stretches out.
  const { tread, kick } = EXPLORE_SWIM;
  out.lift += tread.bob * (1 - s) * Math.sin(time * TAU * tread.rate + swim.offset * TAU);
  if (s <= 0) return out;
  const q = swim.phase - Math.floor(swim.phase);
  const amp = s * (0.55 + 0.45 * swim.effort);
  if (q < kick.share) {
    // The kick: bunch up, then shoot out long, ahead of the pace.
    const k = q / kick.share;
    // …ending at the glide's first stretch, so the hand-over doesn't pop.
    out.squash =
      1 - kick.squash * amp * Math.sin(Math.PI * k) + kick.stretch * amp * (k * k * (3 - 2 * k));
    out.surge = kick.surge * amp * (k * k * (3 - 2 * k));
  } else {
    // The glide: drift back to the pace, easing out of the stretch.
    const g = (q - kick.share) / (1 - kick.share);
    const decay = Math.exp(-g * kick.decay);
    out.surge = kick.surge * amp * (decay - Math.exp(-kick.decay) * g);
    out.squash = 1 + kick.stretch * amp * decay;
  }
  out.pitch += kick.dip * amp * Math.sin(TAU * q);
  out.lift += kick.bob * amp * Math.sin(TAU * q);
  return out;
}

/** Where the swimmer is drawn, from its pose: in place, no allocation. */
export interface SwimPlacement {
  /** Offset of the feet from the swimmer's point, along x and z (world units). */
  dx: number;
  dz: number;
  /** The field's lean: negative pitches the head forward, into the heading (a positive lean leans back). */
  lean: number;
  /** Lift of the feet above the sand (world units). */
  lift: number;
  /** Offset of the body's middle from the swimmer's point, along x and z (for its shadow). */
  midX: number;
  midZ: number;
}

/**
 * The swimmer pitches about its head (`EXPLORE_SWIM.pivot` of its height
 * up), not its feet, so the head stays on its point and the legs trail; the
 * kick's surge carries it ahead along the heading. `tall` is its height in
 * world units; yaw 0 faces −z, so the heading is (−sin yaw, −cos yaw).
 */
export function swimPlacement(
  pose: SwimPose,
  tall: number,
  yaw: number,
  out: SwimPlacement,
): SwimPlacement {
  const pivot = tall * EXPLORE_SWIM.pivot;
  const sin = Math.sin(pose.pitch);
  const ahead = pose.surge * tall - pivot * sin;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  out.dx = fx * ahead;
  out.dz = fz * ahead;
  out.lean = -pose.pitch;
  out.lift = pose.lift * tall + pivot * (1 - Math.cos(pose.pitch));
  // The middle of the body, half its height along it from the feet.
  const mid = ahead + tall * 0.5 * sin;
  out.midX = fx * mid;
  out.midZ = fz * mid;
  return out;
}

/** Kick bubbles (one extra draw) only on the quality tiers that can afford them. */
export function bubblesAt(tier: QualityTier): boolean {
  return EXPLORE_SWIM.bubbleTiers[tier];
}
