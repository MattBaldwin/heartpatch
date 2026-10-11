import { EXPLORE_SWIM } from './explore-config.js';

// Swimming under a lake (#399): the Keeper and the team swim instead of
// hopping. Like the hop (#317), the stroke follows the ground covered, never
// the clock, so a gentle push swims slowly and a full push kicks fast. Each
// swimmer's state is one small object updated in place, and the pose is
// written into a caller's object, so stepping allocates nothing.

export type SwimStyle = 'glide' | 'paddle' | 'dolphin';

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
  /** Heading wiggle, radians. */
  sway: number;
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
 * leaning into the swim without surge, bob or sway.
 */
export function swimPose(
  swim: Swim,
  style: SwimStyle,
  reduce: boolean,
  time: number,
  out: SwimPose,
): SwimPose {
  const look = EXPLORE_SWIM.styles[style];
  const s = swim.stretch;
  out.pitch = look.pitch * s;
  out.lift = EXPLORE_SWIM.float;
  out.squash = 1;
  out.surge = 0;
  out.sway = 0;
  if (reduce) return out;
  // Treading water: a slow bob that fades out as the swim stretches out.
  const tread = 1 - s;
  out.lift +=
    EXPLORE_SWIM.tread.bob *
    tread *
    Math.sin(time * TAU * EXPLORE_SWIM.tread.rate + swim.offset * TAU);
  if (s <= 0) return out;
  const q = swim.phase - Math.floor(swim.phase);
  const amp = s * (0.55 + 0.45 * swim.effort);
  switch (style) {
    case 'glide': {
      // Kick: bunch up, then shoot out long; glide: drift back to the pace.
      const kick = EXPLORE_SWIM.styles.glide.kick;
      if (q < kick) {
        const k = q / kick;
        out.squash = 1 - look.squash * amp * Math.sin(Math.PI * k);
        out.surge = look.surge * amp * (k * k * (3 - 2 * k));
      } else {
        const g = (q - kick) / (1 - kick);
        const decay = Math.exp(-g * 3.2);
        out.surge = look.surge * amp * decay - look.surge * amp * Math.exp(-3.2) * g;
        out.squash = 1 + look.stretch * amp * decay;
      }
      out.pitch += look.dip * amp * Math.sin(TAU * q);
      out.lift += look.bob * amp * Math.sin(TAU * q);
      break;
    }
    case 'paddle': {
      // Two paddles a stroke, left then right: a waggle and a bob each.
      const half = (q * 2) % 1;
      out.sway = look.sway * amp * Math.sin(TAU * q);
      out.lift += look.bob * amp * Math.sin(Math.PI * half);
      out.squash = 1 + look.stretch * amp * Math.cos(TAU * half) * 0.5;
      out.surge = look.surge * amp * Math.sin(TAU * half) * 0.5;
      break;
    }
    case 'dolphin': {
      // One long wave through the body: the nose dips and rises with the float.
      out.pitch += look.dip * amp * Math.sin(TAU * q);
      out.lift += look.bob * amp * Math.sin(TAU * q - Math.PI / 2);
      out.squash = 1 + look.stretch * amp * Math.sin(TAU * q + Math.PI / 2);
      out.surge = look.surge * amp * Math.sin(TAU * q + Math.PI);
      break;
    }
  }
  return out;
}
