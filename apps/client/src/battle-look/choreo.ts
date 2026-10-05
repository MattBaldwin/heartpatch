import type { FeelingId } from '@heartpatch/shared';
import type { MotionLook } from './directions.js';
import { ATTACK, CHARM, FEELING_IDLE, KO, type Sequence } from './shots.js';

/**
 * Pure pose maths for the look prototypes: a fighter's pose is a function of
 * (sequence, role, time, feeling, direction motion). Poses are relative to
 * where the fighter stands; `forward` points at the other fighter.
 */

export interface Pose {
  forward: number;
  side: number;
  lift: number;
  /** Height scale; width follows to keep volume. */
  squash: number;
  /** Length along `forward`. */
  stretch: number;
  /** Tipped towards the other fighter (+). */
  lean: number;
  /** Tipped over sideways. */
  roll: number;
  spin: number;
  scale: number;
}

export const REST: Pose = {
  forward: 0,
  side: 0,
  lift: 0,
  squash: 1,
  stretch: 1,
  lean: 0,
  roll: 0,
  spin: 0,
  scale: 1,
};

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const arc = (t: number) => Math.sin(Math.PI * clamp01(t));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** A wobble that starts big and settles. */
const settle = (t: number, hz: number, decay: number) =>
  Math.cos(t * Math.PI * 2 * hz) * Math.exp(-decay * clamp01(t));

const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });

export type Role = 'actor' | 'target';

/** Idle: breathing is in the shader; this adds each feeling's personality on top. */
export function idlePose(t: number, feeling: FeelingId, motion: MotionLook, phase = 0): Pose {
  const f = FEELING_IDLE[feeling];
  const s = t / 1000 + phase;
  const x = motion.exaggeration;
  let lift = 0;
  let squash = 1;
  let lean = 0.06 * x; // every fighter leans in a touch: ready
  let roll = 0;
  let spin = 0;
  let scale = 1;
  let side = 0;
  // Joy: a hop every 1.3 s.
  if (f.hop > 0) {
    const u = (s % 1.3) / 1.3;
    const air = u < 0.42 ? arc(u / 0.42) : 0;
    lift += f.hop * motion.idleBob * 3.2 * air * x;
    squash *= 1 + f.hop * (0.08 * air - 0.12 * (u > 0.42 && u < 0.6 ? arc((u - 0.42) / 0.18) : 0)) * x;
  }
  // Cozy / sleepy: a slow sway.
  if (f.sway > 0) {
    roll += f.sway * 0.07 * Math.sin(s * 1.4) * x;
    side += f.sway * 0.08 * Math.sin(s * 1.4) * x;
  }
  // Sleepy: nodding off, then a little jolt awake.
  if (f.nod > 0) {
    const u = (s % 2.6) / 2.6;
    const droop = u < 0.75 ? easeIn(u / 0.75) : 1 - easeOut((u - 0.75) / 0.25);
    lean += f.nod * (-0.18 * droop + 0.05) * x;
    squash *= 1 - f.nod * 0.06 * droop;
  }
  // Silly: wiggles.
  if (f.wiggle > 0) {
    spin += f.wiggle * 0.28 * Math.sin(s * 7) * x;
    roll += f.wiggle * 0.06 * Math.sin(s * 7 + 1) * x;
  }
  // Brave: puffed up, a stomp now and then.
  if (f.puff > 0) {
    scale *= 1 + f.puff * 0.06 * x;
    lean += f.puff * 0.08 * x;
    const u = (s % 1.8) / 1.8;
    const stomp = u < 0.2 ? arc(u / 0.2) : 0;
    squash *= 1 - f.puff * 0.1 * stomp * x;
  }
  // Spooky: hovers, bobbing.
  if (f.hover > 0) {
    lift += f.hover * (0.12 + 0.06 * Math.sin(s * 2.2)) * x;
    roll += f.hover * 0.04 * Math.sin(s * 1.1) * x;
  }
  // Everyone bobs a little on their toes (not with reduced motion: the caller passes idleBob 0).
  lift += motion.idleBob * 0.5 * (0.5 + 0.5 * Math.sin(s * 2 * Math.PI * 1.3));
  return pose({ lift, squash, lean, roll, spin, scale, side });
}

export interface ActContext {
  readonly motion: MotionLook;
  readonly feeling: FeelingId;
  /** Distance to arm's length of the other fighter. */
  readonly reach: number;
  readonly reduced: boolean;
  /** 1 normal, more for a super hit. */
  readonly strength: number;
}

/** The attacker through an attack. */
export function attackerPose(t: number, c: ActContext): Pose {
  const x = c.reduced ? 0.45 : c.motion.exaggeration;
  const reach = c.reduced ? c.reach * 0.35 : c.reach;
  const f = FEELING_IDLE[c.feeling];
  const hitStop = c.motion.hitStop;
  if (t < ATTACK.windup) {
    // Anticipation: pull back, squat, lean away; each feeling its own flavour.
    const w = easeOut(t / ATTACK.windup);
    const p = pose({
      forward: -0.45 * x * w,
      squash: 1 - 0.22 * x * w,
      lean: -0.28 * x * w,
    });
    if (f.puff > 0) {
      p.scale = 1 + 0.12 * x * w;
      p.squash -= 0.08 * x * w;
    }
    if (f.wiggle > 0) p.spin = Math.PI * 2 * easeIn(w) * (c.reduced ? 0 : 1);
    if (f.hop > 0) p.lift = 0.5 * arc(w * 1.6) * x * (w < 0.62 ? 1 : 0);
    if (f.hover > 0) p.lift = 0.5 * x * w;
    if (f.nod > 0) p.lean = -0.4 * x * w;
    return p;
  }
  if (t < ATTACK.dashEnd) {
    // The dash: stretched long and low, leaning in.
    const d = span(t, ATTACK.windup, ATTACK.dashEnd) ** 1.6;
    return pose({
      forward: lerp(-0.45 * x, reach, d),
      squash: lerp(1 - 0.22 * x, 0.9, d),
      stretch: 1 + 0.26 * x * arc(d),
      lean: lerp(-0.28 * x, 0.32 * x, d),
      lift: 0.18 * x * arc(d) + (f.hover > 0 ? 0.3 * x * (1 - d) : 0),
    });
  }
  if (t < ATTACK.dashEnd + hitStop) {
    // Hit-stop: braced at arm's length, squashed into the contact.
    return pose({ forward: reach, squash: 0.86, stretch: 1.12, lean: 0.38 * x });
  }
  // Follow-through: a recoil hop, then home.
  const u = span(t, ATTACK.dashEnd + hitStop, ATTACK.home);
  const back = easeOut(u);
  return pose({
    forward: lerp(reach, 0, back),
    lift: 0.5 * x * arc(span(u, 0.1, 0.7)),
    squash: 1 + 0.12 * x * settle(u, 1.6, 4),
    lean: lerp(0.38 * x, 0.06 * x, back),
    spin: f.wiggle > 0 && !c.reduced ? Math.PI * 2 * easeOut(span(u, 0.15, 0.75)) : 0,
  });
}

/** The one being hit through an attack. */
export function targetPose(t: number, c: ActContext): Pose {
  const x = c.reduced ? 0.45 : c.motion.exaggeration;
  const hitStop = c.motion.hitStop;
  if (t < ATTACK.dashEnd) return REST;
  if (t < ATTACK.dashEnd + hitStop) {
    // The bonk: squashed flat and tipped back.
    return pose({ squash: 1 - 0.3 * x * c.strength, stretch: 0.9, lean: -0.35 * x, forward: -0.15 * x });
  }
  // Knockback with a wobble, then springs home dizzy.
  const u = span(t, ATTACK.dashEnd + hitStop, ATTACK.home);
  const kb = c.motion.knockback * c.strength * (c.reduced ? 0.4 : 1);
  const out = u < 0.3 ? easeOut(u / 0.3) : 1 - easeOut(span(u, 0.55, 1)) * 1;
  return pose({
    forward: -kb * out,
    lift: 0.45 * x * arc(u / 0.3) * (u < 0.3 ? 1 : 0),
    squash: 1 - 0.28 * x * settle(u, 2.2, 3.5) * (u < 0.75 ? 1 : 1 - span(u, 0.75, 1)),
    lean: -0.3 * x * (1 - easeOut(u)),
    roll: 0.12 * x * Math.sin(u * Math.PI * 4) * (1 - u),
  });
}

/** A Heart Charm thrown at `target`: it's drawn in, hovers small above the charm, pops free (a friend!). */
export function charmedPose(t: number, c: ActContext): Pose {
  const x = c.motion.exaggeration;
  if (t < CHARM.flight) return pose({ lean: -0.05, squash: 1 - 0.04 * arc(t / CHARM.flight) });
  if (t < CHARM.drawn) {
    const u = easeIn(span(t, CHARM.flight, CHARM.drawn));
    return pose({ scale: lerp(1, 0.22, u), lift: lerp(0, 0.9, u), spin: u * Math.PI * 2 * x, squash: 1 + 0.2 * u });
  }
  if (t < CHARM.pop) {
    const u = span(t, CHARM.drawn, CHARM.pop);
    return pose({ scale: 0.22, lift: 0.9 + 0.08 * Math.sin(u * Math.PI * 6), spin: Math.sin(u * Math.PI * 6) * 0.3 });
  }
  const u = easeOut(span(t, CHARM.pop, CHARM.length));
  return pose({ scale: lerp(0.22, 1, u), lift: 0.6 * arc(u), squash: 1 - 0.15 * settle(u, 1.5, 3) });
}

/** The thrower of a Heart Charm: a little hop of hope. */
export function throwerPose(t: number, c: ActContext): Pose {
  const x = c.motion.exaggeration;
  if (t < CHARM.flight) {
    const u = t / CHARM.flight;
    return pose({ lean: 0.2 * x * arc(u), squash: 1 - 0.08 * arc(u) });
  }
  // Leaning in, watching the wobble.
  return pose({ lean: 0.12 * x, squash: 0.97, forward: 0.15 * x });
}

/** Tuckered out: staggers, twirls, flops over and lies dizzy (style guide: never hurt). */
export function koPose(t: number, c: ActContext): Pose {
  const x = c.reduced ? 0.5 : c.motion.exaggeration;
  if (t < KO.stagger) {
    const u = t / KO.stagger;
    return pose({ side: 0.25 * x * Math.sin(u * Math.PI * 3), lean: -0.1 * x, squash: 1 - 0.05 * arc(u) });
  }
  if (t < KO.twirl) {
    const u = span(t, KO.stagger, KO.twirl);
    return pose({
      spin: c.reduced ? 0 : Math.PI * 2 * easeOut(u),
      lift: 0.25 * x * arc(u),
      lean: -0.15 * x,
      roll: 0.2 * x * u,
    });
  }
  if (t < KO.flop) {
    const u = easeIn(span(t, KO.twirl, KO.flop));
    return pose({ roll: lerp(0.2 * x, 1.35, u), lift: -0.08 * u, squash: 1 - 0.1 * u, lean: -0.1 });
  }
  const u = span(t, KO.flop, KO.flop + 500);
  return pose({ roll: 1.35, lift: -0.08, squash: 0.9 + 0.08 * Math.abs(settle(u, 2, 5)), lean: -0.1 });
}

/** The winner: two happy hops and a spin. */
export function victoryPose(t: number, c: ActContext): Pose {
  const x = c.reduced ? 0.4 : c.motion.exaggeration;
  if (t < KO.twirl) return idleishLean(x);
  const u = span(t, KO.twirl, KO.length);
  const hop = arc((u * 2.2) % 1) * (u < 0.9 ? 1 : 0);
  return pose({ lift: 0.6 * x * hop, squash: 1 + 0.1 * x * hop, lean: 0.1 * x, spin: c.reduced ? 0 : Math.PI * 2 * easeOut(span(u, 0.5, 1)) });
}

function idleishLean(x: number): Pose {
  return pose({ lean: 0.06 * x });
}

/** The pose for a fighter in a sequence at `t`. */
export function poseFor(seq: Sequence, role: Role, t: number, c: ActContext): Pose {
  switch (seq) {
    case 'idle':
      return idlePose(t, c.feeling, c.motion);
    case 'attack':
      return role === 'actor' ? attackerPose(t, c) : targetPose(t, c);
    case 'charm':
      return role === 'actor' ? throwerPose(t, c) : charmedPose(t, c);
    case 'ko':
      return role === 'actor' ? koPose(t, c) : victoryPose(t, c);
  }
}
