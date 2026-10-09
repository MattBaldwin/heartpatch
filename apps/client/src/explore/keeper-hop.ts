import { EXPLORE_HOP, EXPLORE_VIEW } from './explore-config.js';

// The hop as the Keeper and the team walk (#317, owner mockup 2026-10-09).
// Pure numbers: one hop per stride, so the hop rate follows the ground
// covered, never the clock. Each hopper's state is one small object updated
// in place, so stepping it every frame allocates nothing. The scene draws the
// pose by lifting and squashing the root; colliders and the ground point
// never see it.

export interface Hop {
  /** Hops taken; the fraction is how far through the current one (0 is touching down). */
  phase: number;
  /** 0 (small, quick hops) to 1 (long, higher hops), eased toward the stick. */
  effort: number;
  /** Ground covered since this walk started, tile-local. */
  walked: number;
  /** Hops a second over the last step (for landing at the same pace). */
  rate: number;
  /** Hops a second while coming down after the walk stopped mid-air. */
  landRate: number;
  /** Ms into the settle squish, or −1. */
  settle: number;
  moving: boolean;
  landing: boolean;
  /**
   * Where this walk's first hop begins. A follower starts its walk `offset`
   * hops before it, gliding on the ground, so it takes off from the ground
   * out of step with the others.
   */
  from: number;
  /** How many hops a follower glides before its first one, out of step with the rest. */
  readonly offset: number;
}

export interface HopPose {
  /** Lift above the ground point, share of the hopper's height. */
  lift: number;
  /** Height scale about the feet (1 is none); the width is 1/√squash, keeping the volume. */
  squash: number;
}

export function createHop(offset = 0): Hop {
  return {
    phase: 0,
    effort: 0,
    walked: 0,
    rate: 0,
    landRate: 0,
    settle: -1,
    moving: false,
    landing: false,
    from: 0,
    offset,
  };
}

/** Still hopping, landing or settling: keep drawing. */
export function hopActive(hop: Hop): boolean {
  return hop.moving || hop.landing || hop.settle >= 0;
}

/** The ground covered by one hop at this effort, tile-local. */
export function strideAt(effort: number): number {
  const { min, max } = EXPLORE_HOP.stride;
  return min + (max - min) * effort;
}

/** A move longer than this in one frame is a jump to a new place (a new tile), not a step. */
export const TELEPORT =
  EXPLORE_VIEW.walkSpeed * EXPLORE_VIEW.maxFrameStep * EXPLORE_HOP.teleportFrames;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * One frame: `ds` is the ground covered (tile-local), `dt` seconds, `push`
 * the stick's push (0–1; a tap-walk is 1). With Reduce Motion the hopper
 * only bobs, and comes to rest without a settle squish.
 */
export function stepHop(hop: Hop, ds: number, dt: number, push: number, reduce: boolean): void {
  if (ds > 0) {
    if (!hop.moving) {
      // A new walk starts on the ground, gliding `offset` hops before the
      // first one; a walk that picks up again while still coming down
      // carries on from the air.
      if (!hop.landing) {
        hop.from = Math.ceil(hop.phase);
        hop.phase = hop.from - hop.offset;
      }
      hop.walked = 0;
      hop.settle = -1;
      hop.landing = false;
      hop.moving = true;
    }
    hop.walked += ds;
    const warm =
      EXPLORE_HOP.warmFloor +
      (1 - EXPLORE_HOP.warmFloor) * clamp01(hop.walked / EXPLORE_HOP.warmUp);
    const goal = clamp01(push) * warm;
    if (dt > 0) hop.effort += (goal - hop.effort) * (1 - Math.exp(-dt / EXPLORE_HOP.effortEase));
    const hops = ds / strideAt(hop.effort);
    hop.phase += hops;
    if (dt > 0) hop.rate = hops / dt;
    return;
  }
  if (hop.moving) {
    // Let go (or stuck against a rock): come down, then settle.
    hop.moving = false;
    if (hop.phase < hop.from) {
      // Stopped before the first hop: nothing to land or settle.
      hop.phase = hop.from;
      hop.rate = 0;
      return;
    }
    const frac = hop.phase - Math.floor(hop.phase);
    if (frac > (reduce ? 0 : EXPLORE_HOP.contact)) {
      hop.landing = true;
      hop.landRate = Math.max(hop.rate, (1 - frac) / (EXPLORE_HOP.landMs / 1000));
    } else {
      touchDown(hop, reduce, Math.floor(hop.phase));
    }
    hop.rate = 0;
  }
  if (hop.landing) {
    const next = hop.phase + hop.landRate * dt;
    if (Math.floor(next) > Math.floor(hop.phase)) touchDown(hop, reduce, Math.floor(next));
    else hop.phase = next;
    return;
  }
  if (hop.settle >= 0) {
    hop.settle += dt * 1000;
    if (hop.settle >= EXPLORE_HOP.settleMs) {
      hop.settle = -1;
      hop.effort = 0;
    }
  }
}

function touchDown(hop: Hop, reduce: boolean, phase: number): void {
  hop.phase = phase;
  hop.landing = false;
  hop.settle = reduce ? -1 : 0;
  if (reduce) hop.effort = 0;
}

/**
 * The pose for this frame into `out` (no allocation). `lift` scales the hop
 * height (the followers hop a little lower for their size).
 */
export function hopPose(hop: Hop, reduce: boolean, lift: number, out: HopPose): HopPose {
  out.lift = 0;
  out.squash = 1;
  if (hop.phase < hop.from) return out; // still gliding before the first hop
  const frac = hop.phase - Math.floor(hop.phase);
  if (hop.moving || hop.landing) {
    if (reduce) {
      out.lift = EXPLORE_HOP.bob * Math.sin(Math.PI * frac);
      return out;
    }
    const e = hop.effort;
    const { min, max } = EXPLORE_HOP.height;
    // Gentle hops squash a little less than big ones.
    const amp = 0.6 + 0.4 * e;
    const contact = EXPLORE_HOP.contact;
    if (frac < contact) {
      out.squash = 1 - EXPLORE_HOP.squash * amp * Math.sin((Math.PI * frac) / contact);
    } else {
      const q = (frac - contact) / (1 - contact);
      out.lift = (min + (max - min) * e) * lift * Math.sin(Math.PI * q);
      // Stretched leaving the ground, round at the top, eased off before touching down.
      out.squash =
        1 +
        EXPLORE_HOP.stretch *
          amp *
          Math.abs(Math.cos(Math.PI * q)) *
          smooth(0, 0.15, q) *
          (1 - smooth(0.78, 1, q));
    }
    return out;
  }
  if (hop.settle >= 0 && !reduce) {
    const t = hop.settle / EXPLORE_HOP.settleMs;
    out.squash =
      t < 0.55
        ? 1 - EXPLORE_HOP.settleSquash * Math.sin((Math.PI * t) / 0.55)
        : 1 + EXPLORE_HOP.settleRebound * Math.sin((Math.PI * (t - 0.55)) / 0.45);
  }
  return out;
}

/** The shadow's width under a hopper this high (share of its height): 1 on the ground, `shadowMin` at the top of the highest hop. */
export function shadowScale(lift: number): number {
  const top = EXPLORE_HOP.height.max;
  return 1 - (1 - EXPLORE_HOP.shadowMin) * clamp01(lift / top);
}

/** The shadow's opacity under a hopper this high (#323): 1 on the ground, fading by `shadowFade` at the top of the highest hop. */
export function shadowAlpha(lift: number): number {
  return 1 - EXPLORE_HOP.shadowFade * clamp01(lift / EXPLORE_HOP.height.max);
}
