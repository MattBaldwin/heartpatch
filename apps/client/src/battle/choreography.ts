import type { BattleSideId, FeelingId, Move } from '@heartpatch/shared';
import type { SquishMove } from '../procedural/config.js';
import { BATTLE_CAMERA as CHOREO_CAMERA, CHOREO } from './battle-config.js';
import type { PlaybackStep } from './battle-playback.js';

/*
 * Saturday Morning Smackdown's hits (owner decision 2026-10-05): what each
 * step of the server's resolved log looks like. Pure: a step becomes a plan
 * (who does what, when, which effects and camera beats), and a fighter's
 * pose is a pure function of its current act, its feeling and the time. The
 * scene samples it every frame; no randomness, so a replay looks the same.
 * Battle logic is never touched: this only reads the log the server sent
 * (CLAUDE.md rule 1).
 *
 * Style guide: punchy, never hurt. Hits are boops and bonks with squash,
 * knockback and sparkles; tuckered-out squishies flop over dizzy, no blood,
 * no gore, nothing scary. Each feeling shows in how a squishy stands and
 * how it winds up (style guide §5: Joy bounces, Cozy snuggles, Brave puffs
 * up, Silly spins, Sleepy nods off, Spooky goes "boo!").
 */

/**
 * A fighter's pose, relative to where it stands. `forward` is towards the
 * other fighter and `side` to its right; angles in radians.
 */
export interface Pose {
  readonly forward: number;
  readonly side: number;
  readonly lift: number;
  /** Height scale (1 at rest); width follows to keep the volume. */
  readonly squash: number;
  /** Length along `forward` (1 at rest): a dash stretches. */
  readonly stretch: number;
  /** Tipped towards the other fighter (+) or back (−). */
  readonly lean: number;
  /** Tipped over sideways (a tuckered-out flop). */
  readonly roll: number;
  /** Turned about its own middle (a twirl). */
  readonly spin: number;
  /** Overall size (1 at rest; 0 is gone, as when swapped out or in a Heart Charm). */
  readonly scale: number;
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

/** Things a fighter can do (each an act with a start and a length). */
export type ActKind =
  /** Wind up, then dash in to the other fighter and stop at arm's length. */
  | 'dash'
  /** After landing a hit: follow through, then hop back home. */
  | 'follow'
  /** The bonk lands: squashed flat and tipped back, held through the hit-stop. */
  | 'brace'
  /** Hit: squashed and pushed back, then springs home. */
  | 'knockback'
  /** A miss: the attacker overshoots and stumbles back home. */
  | 'overshoot'
  /** The target of a miss hops aside. */
  | 'dodge'
  /** A move that isn't a hit (a hex or a boost): rears up and thrusts. */
  | 'cast'
  /** A stat going up or energy back: squat, spring and twirl. */
  | 'power-up'
  /** A stat going down, a status taking hold: a little shiver. */
  | 'shiver'
  /** Tuckered out: staggers, twirls and flops over (held). */
  | 'faint'
  /** Hops back and shrinks away (swapped out, held). */
  | 'swap-out'
  /** Drops in from above and lands with a squash. */
  | 'swap-in'
  /** Drawn into a Heart Charm (held small, hovering over it). */
  | 'charmed'
  /** Pops back out of a Heart Charm: a friend, or wiggled free. */
  | 'pop-out'
  /** Won: two happy hops and a twirl. */
  | 'victory'
  /** Scooted away (forfeit): turns tail and hops off (held). */
  | 'scoot'
  /** Back home from wherever the last act left it. */
  | 'return';

/** Where an act leaves the fighter once it's over. */
export type ActEnd = 'home' | 'contact' | 'down' | 'gone' | 'small';

export const ACT_END: Readonly<Record<ActKind, ActEnd>> = {
  dash: 'contact',
  follow: 'home',
  brace: 'home',
  knockback: 'home',
  overshoot: 'home',
  dodge: 'home',
  cast: 'home',
  'power-up': 'home',
  shiver: 'home',
  faint: 'down',
  'swap-out': 'gone',
  'swap-in': 'home',
  charmed: 'small',
  'pop-out': 'home',
  victory: 'home',
  scoot: 'gone',
  return: 'home',
};

/** An act playing on a fighter. Times are ms on the battle clock. */
export interface Act {
  readonly kind: ActKind;
  readonly start: number;
  readonly ms: number;
  /** The pose when it started (acts blend out of it, so nothing ever jumps). */
  readonly from: Pose;
  /** Distance to arm's length of the other fighter (dashes stop there). */
  readonly reach: number;
  /** 1 normal; more for a super hit, less for a weak one. */
  readonly strength: number;
  /** The fighter's feeling: its personality shows in the wind-up and the follow-through. */
  readonly feeling: FeelingId;
  /** `prefers-reduced-motion`: smaller, no twirls (see CHOREO.reduced). */
  readonly reduced: boolean;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** 0 → 1 → 0 over [0, 1]: a hop's arc. */
const arc = (t: number) => Math.sin(Math.PI * clamp01(t));
/** A decaying wobble: starts at 1, settles to 0. */
const settle = (t: number, wobbles = 2) =>
  Math.cos(t * Math.PI * 2 * wobbles) * Math.exp(-4 * clamp01(t));
/** A wobble that starts at rest and settles: 0 → ±1 → 0 over [0, 1]. */
const wobble = (t: number) => Math.sin(t * Math.PI * 3) * Math.exp(-3 * t);
/** Where `t` is inside [a, b], 0–1. */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    forward: lerp(a.forward, b.forward, t),
    side: lerp(a.side, b.side, t),
    lift: lerp(a.lift, b.lift, t),
    squash: lerp(a.squash, b.squash, t),
    stretch: lerp(a.stretch, b.stretch, t),
    lean: lerp(a.lean, b.lean, t),
    roll: lerp(a.roll, b.roll, t),
    spin: lerp(a.spin, b.spin, t),
    scale: lerp(a.scale, b.scale, t),
  };
}

const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });

/**
 * Each feeling's personality (style guide §5), 0–1 per trait: how much it
 * hops, sways, nods off, wiggles, puffs up or hovers. Shows in the idle
 * stance and in the wind-up of a strike.
 */
export interface FeelingTraits {
  readonly hop: number;
  readonly sway: number;
  readonly nod: number;
  readonly wiggle: number;
  readonly puff: number;
  readonly hover: number;
}

export const FEELING_TRAITS: Readonly<Record<FeelingId, FeelingTraits>> = {
  joy: { hop: 1, sway: 0, nod: 0, wiggle: 0, puff: 0, hover: 0 },
  cozy: { hop: 0, sway: 1, nod: 0.3, wiggle: 0, puff: 0, hover: 0 },
  brave: { hop: 0, sway: 0, nod: 0, wiggle: 0, puff: 1, hover: 0 },
  silly: { hop: 0.3, sway: 0, nod: 0, wiggle: 1, puff: 0, hover: 0 },
  sleepy: { hop: 0, sway: 0.3, nod: 1, wiggle: 0, puff: 0, hover: 0 },
  spooky: { hop: 0, sway: 0.4, nod: 0, wiggle: 0.3, puff: 0, hover: 1 },
}; // TUNE

/** The pose a held act leaves (for an act that ends away from home). */
export function heldPose(kind: ActKind, reach: number, reduced: boolean): Pose {
  switch (ACT_END[kind]) {
    case 'contact':
      return pose({ forward: reduced ? reach * CHOREO.reduced.reach : reach });
    case 'down':
      return pose({ roll: CHOREO.faint.roll, lift: -CHOREO.faint.sink, squash: 0.92 });
    case 'gone':
      return pose({ scale: 0 });
    case 'small':
      return pose({ scale: CHOREO.charm.shrink, lift: CHOREO.charm.lift });
    case 'home':
      return REST;
  }
}

/** The act's own curve at `u` (0–1 through it), before blending out of `from`. */
function curve(act: Act, u: number): Pose {
  const s = act.strength;
  const r = act.reduced;
  const f = FEELING_TRAITS[act.feeling];
  // Reduced motion: smaller moves and no twirls.
  const big = r ? CHOREO.reduced.size : CHOREO.exaggeration;
  const twirl = r ? 0 : 1;
  switch (act.kind) {
    case 'dash': {
      const reach = r ? act.reach * CHOREO.reduced.reach : act.reach;
      const { windup, travel } = CHOREO.dash;
      if (u < windup) {
        // Anticipation: pull back and squat, leaning away; each feeling its own flavour.
        const w = easeOut(u / windup);
        return pose({
          forward: -0.35 * big * w,
          squash: 1 - 0.2 * big * w - 0.08 * f.puff * big * w,
          lean: -0.22 * big * w - 0.18 * f.nod * big * w,
          // Brave puffs up; Spooky lifts off; Joy hops in place; Silly spins up.
          scale: 1 + 0.12 * f.puff * big * w,
          lift: 0.35 * f.hover * big * w + 0.45 * f.hop * big * arc(w * 1.6) * (w < 0.62 ? 1 : 0),
          spin: twirl * f.wiggle * Math.PI * 2 * easeIn(w),
        });
      }
      if (u < windup + travel) {
        // The dash: stretched long and low, leaning in.
        const d = span(u, windup, windup + travel) ** 2;
        return pose({
          forward: lerp(-0.35 * big, reach, d),
          squash: lerp(1 - 0.2 * big, 0.88, d),
          stretch: 1 + 0.32 * big * arc(d),
          lean: lerp(-0.22 * big, 0.3 * big, d),
          lift: 0.12 * big * arc(d) + 0.35 * f.hover * big * (1 - d),
          scale: 1 + 0.12 * f.puff * big * (1 - d),
        });
      }
      // Arrives at arm's length and braces (held until the hit lands).
      const a = span(u, windup + travel, 1);
      return pose({
        forward: reach,
        squash: lerp(0.88, 1, easeOut(a)) + 0.05 * big * settle(a, 1),
        lean: lerp(0.3 * big, 0.12 * big, easeOut(a)),
      });
    }
    case 'follow': {
      // Follow-through (a little shove forward), then a hop back home; Silly spins on the way.
      const reach = r ? act.reach * CHOREO.reduced.reach : act.reach;
      const push = span(u, 0, 0.18);
      const back = easeInOut(span(u, 0.25, 0.85));
      const land = span(u, 0.85, 1);
      return pose({
        forward: lerp(reach + 0.25 * big * arc(push), 0, back),
        lift: (0.5 + 0.25 * f.hop) * big * arc(back),
        lean: lerp(0.3 * big, -0.1 * big, back) * (1 - land),
        squash: 1 + (land > 0 ? -0.15 * big * settle(land, 1) : 0.08 * big * arc(back)),
        spin: twirl * f.wiggle * Math.PI * 2 * easeOut(span(u, 0.25, 0.85)),
      });
    }
    case 'brace': {
      // The bonk: squashed flat and tipped back, fast, then held (the hit-stop).
      const w = easeOut(span(u, 0, 0.3));
      return pose({
        squash: 1 - 0.3 * big * Math.min(1, s) * w,
        stretch: 1 - 0.08 * w,
        lean: -0.35 * big * w,
        forward: -0.15 * big * w,
      });
    }
    case 'knockback': {
      // Squashed flat by the bonk, sent skidding back with a little hop,
      // then springs home with a wobble.
      const k = CHOREO.knockback.distance * s * big;
      const fly = easeOut(span(u, 0.05, 0.45));
      const home = easeInOut(span(u, 0.55, 1));
      const after = span(u, 0.25, 1);
      const squash =
        1 -
        0.38 * big * Math.min(1, s) * arc(span(u, 0, 0.25)) +
        0.12 * big * Math.sin(after * Math.PI * 4) * Math.exp(-3 * after);
      return pose({
        forward: lerp(-k * fly, 0, home),
        lift: 0.35 * big * Math.min(1.4, s) * arc(span(u, 0.08, 0.45)),
        lean: -0.45 * big * Math.min(1.3, s) * arc(span(u, 0, 0.6)),
        squash: Math.max(0.55, squash),
        stretch: 1 + 0.15 * big * arc(span(u, 0.1, 0.4)),
        spin: twirl * (s > 1.2 ? Math.PI * 2 * easeOut(span(u, 0.1, 0.6)) : 0),
      });
    }
    case 'overshoot': {
      // Whoosh past where the other one was, skid, then back home sheepishly.
      const reach = r ? act.reach * CHOREO.reduced.reach : act.reach;
      const past = easeOut(span(u, 0, 0.3));
      const home = easeInOut(span(u, 0.45, 1));
      return pose({
        forward: lerp(reach + 0.9 * big * past, 0, home),
        lean: lerp(0.35 * big, -0.25 * big, past) * (1 - home),
        squash: 1 - 0.12 * big * arc(span(u, 0.25, 0.45)),
        lift: 0.35 * big * arc(home),
        roll: 0.15 * big * Math.sin(span(u, 0.3, 0.5) * Math.PI * 3) * (1 - home),
      });
    }
    case 'dodge': {
      // A quick hop to the side, then back.
      const out = easeOut(span(u, 0, 0.3));
      const back = easeInOut(span(u, 0.5, 1));
      return pose({
        side: lerp(CHOREO.dodge.side * big * out, 0, back),
        lift: 0.55 * big * arc(span(u, 0, 0.35)) + 0.3 * big * arc(back),
        roll: -0.3 * big * arc(span(u, 0, 0.45)),
        squash: 1 + 0.1 * big * arc(span(u, 0, 0.3)),
      });
    }
    case 'cast': {
      // Rears up tall, then thrusts forward as the move goes out.
      const rise = easeOut(span(u, 0, 0.4));
      const thrust = span(u, 0.4, 0.6);
      const back = easeInOut(span(u, 0.6, 1));
      return pose({
        lift: 0.35 * big * rise * (1 - back),
        squash: lerp(1 + 0.18 * big * rise, 1, back) - 0.15 * big * arc(thrust),
        lean: lerp(-0.25 * big * rise, 0.35 * big, easeOut(thrust)) * (1 - back),
        forward: 0.4 * big * arc(span(u, 0.4, 1)),
      });
    }
    case 'power-up': {
      // Squat, spring up with a twirl, land with a wobble.
      const squat = arc(span(u, 0, 0.3));
      const air = span(u, 0.25, 0.75);
      const land = span(u, 0.75, 1);
      return pose({
        squash:
          u < 0.3
            ? 1 - 0.22 * big * squat
            : 1 + 0.12 * big * arc(air) - 0.12 * big * settle(land, 1) * (land > 0 ? 1 : 0),
        lift: 0.8 * big * arc(air),
        spin: twirl * Math.PI * 2 * easeInOut(air),
      });
    }
    case 'shiver':
      return pose({
        side: 0.08 * big * Math.sin(u * Math.PI * 10) * (1 - u),
        squash: 1 - 0.08 * big * arc(u),
        lean: -0.08 * big * arc(u),
      });
    case 'faint': {
      // Staggers back, twirls dizzily, flops over with a little bounce.
      const stagger = easeOut(span(u, 0, 0.35));
      const flop = easeIn(span(u, 0.35, 0.7));
      const bounce = span(u, 0.7, 1);
      const down = heldPose('faint', act.reach, r);
      return pose({
        forward: -0.6 * big * stagger,
        side: 0.2 * big * Math.sin(span(u, 0, 0.35) * Math.PI * 3) * (1 - stagger),
        lift:
          0.4 * big * arc(span(u, 0, 0.35)) +
          lerp(0, down.lift, flop) +
          0.15 * big * arc(bounce) * (1 - bounce),
        spin: twirl * Math.PI * 1.5 * easeOut(span(u, 0.05, 0.6)),
        roll: lerp(0, down.roll, flop) - 0.12 * big * settle(bounce, 1) * (bounce > 0 ? 1 : 0),
        squash: lerp(1, down.squash, flop),
        lean: -0.2 * big * arc(span(u, 0, 0.5)),
      });
    }
    case 'swap-out': {
      const t = easeIn(span(u, 0.2, 1));
      return pose({
        forward: -1.2 * big * t,
        lift: 0.6 * big * arc(span(u, 0, 0.8)),
        squash: u < 0.2 ? 1 - 0.18 * arc(u / 0.2) : 1,
        scale: 1 - t,
      });
    }
    case 'swap-in': {
      // Drops from above, lands with a big squash and a wobble.
      const fall = span(u, 0, 0.45) ** 2; // like gravity
      const land = span(u, 0.45, 1);
      return pose({
        lift: (1 - fall) * CHOREO.swapIn.height * big,
        scale: lerp(0.4, 1, easeOut(span(u, 0, 0.3))),
        stretch: 1,
        squash:
          u < 0.45
            ? 1 + 0.12 * big * fall
            : 1 - 0.32 * big * arc(span(land, 0, 0.35)) + 0.1 * big * wobble(span(land, 0.35, 1)),
      });
    }
    case 'charmed': {
      // Drawn into the Heart Charm: squish, shrink, lift and hover over it.
      const t = easeInOut(span(u, 0.1, 0.8));
      return pose({
        scale: lerp(1, CHOREO.charm.shrink, t),
        lift: lerp(0, CHOREO.charm.lift, t) + 0.08 * Math.sin(u * Math.PI * 6) * t,
        squash: 1 - 0.2 * arc(span(u, 0, 0.25)) + 0.2 * t,
        spin: twirl * Math.PI * 2 * t,
      });
    }
    case 'pop-out': {
      const t = easeOut(span(u, 0, 0.4));
      const land = span(u, 0.4, 1);
      return pose({
        scale: lerp(CHOREO.charm.shrink, 1, t),
        lift: lerp(CHOREO.charm.lift, 0, t) + 0.5 * big * arc(span(u, 0.1, 0.55)),
        squash: 1 - 0.2 * big * settle(land, 2) * (land > 0 ? 1 : 0),
      });
    }
    case 'victory': {
      // Two happy hops, the second with a twirl.
      const hop = (u * 2) % 1;
      const second = u >= 0.5;
      return pose({
        lift: 0.7 * big * arc(hop),
        squash: 1 + 0.1 * big * arc(hop) - 0.18 * big * (1 - arc(hop)) ** 4,
        spin: twirl * (second ? Math.PI * 2 * easeInOut(hop) : 0),
      });
    }
    case 'scoot': {
      const t = easeIn(span(u, 0.2, 1));
      return pose({
        spin: twirl * Math.PI * easeOut(span(u, 0, 0.3)),
        forward: -3 * big * t,
        lift: 0.4 * big * Math.abs(Math.sin(u * Math.PI * 3)),
        scale: 1 - t,
      });
    }
    case 'return': {
      const t = easeInOut(u);
      // A hop home from the pose it was left in (a dash's contact).
      return pose({ lift: 0.3 * big * arc(t) * Math.min(1, Math.abs(act.from.forward)) });
    }
  }
}

/** How long acts take to blend out of the pose they started in, ms. */
const BLEND_MS = 90;

/** The fighter's pose `now`, playing `act` (null: standing at home). */
export function actPose(act: Act | null, now: number): Pose {
  if (!act) return REST;
  const elapsed = now - act.start;
  if (elapsed < 0) return act.from;
  const u = clamp01(elapsed / act.ms);
  if (u >= 1) return heldPose(act.kind, act.reach, act.reduced);
  const p = curve(act, u);
  // `return` and acts that start away from home blend from where they were.
  if (act.kind === 'return') return addOffset(p, lerpPose(act.from, REST, easeInOut(u)));
  const b = clamp01(elapsed / BLEND_MS);
  // Nothing to blend out of when it wasn't there (swapped out, in a charm).
  if (b >= 1 || act.from.scale < 0.2) return p;
  return lerpPose(act.from, p, easeOut(b));
}

/** `p` with the movement of `base` added (offsets add, scales multiply). */
export function addOffset(p: Pose, base: Pose): Pose {
  return {
    forward: p.forward + base.forward,
    side: p.side + base.side,
    lift: p.lift + base.lift,
    squash: p.squash * base.squash,
    stretch: p.stretch * base.stretch,
    lean: p.lean + base.lean,
    roll: p.roll + base.roll,
    spin: p.spin + base.spin,
    scale: p.scale * base.scale,
  };
}

/** True while `act` is still moving at `now` (the scene keeps drawing every frame). */
export function actRunning(act: Act | null, now: number): boolean {
  return act !== null && now < act.start + act.ms;
}

/**
 * Standing ready while nothing else plays: a touch of lean towards the other
 * fighter, a light bob on the toes, and the feeling's personality on top:
 * Joy hops, Cozy sways, Brave puffs up and stomps, Silly wiggles, Sleepy nods
 * off and jolts awake, Spooky hovers. `phase` keeps the two fighters out of
 * step. Reduced motion: the stance alone, still.
 */
export function readyPose(now: number, phase: number, feeling: FeelingId, reduced: boolean): Pose {
  const f = FEELING_TRAITS[feeling];
  const { lean: baseLean, bob, bobHz } = CHOREO.ready;
  const x = CHOREO.exaggeration;
  if (reduced) {
    return pose({
      lean: baseLean + 0.06 * f.puff,
      scale: 1 + 0.06 * f.puff * x,
      lift: 0.12 * f.hover * x,
    });
  }
  const s = now / 1000 + phase;
  let lift = 0;
  let squash = 1;
  let lean = baseLean * x;
  let roll = 0;
  let spin = 0;
  let scale = 1;
  let side = 0;
  // Joy: a hop every 1.3 s.
  if (f.hop > 0) {
    const u = (s % 1.3) / 1.3;
    const air = u < 0.42 ? arc(u / 0.42) : 0;
    lift += f.hop * bob * 3.2 * air * x;
    squash *=
      1 + f.hop * (0.08 * air - 0.12 * (u > 0.42 && u < 0.6 ? arc((u - 0.42) / 0.18) : 0)) * x;
  }
  // Cozy / Sleepy: a slow sway.
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
  // Everyone bobs a little on their toes.
  lift += bob * 0.5 * (0.5 + 0.5 * Math.sin(s * 2 * Math.PI * bobHz));
  return pose({ lift, squash, lean, roll, spin, scale, side });
}

// ── Plans: one per step of the log ───────────────────────────────────────

/** How a move looks: a hit with power, a hex at the other side, or a boost for itself. */
export type MoveStyle = 'strike' | 'hex' | 'boost';

export function moveStyle(move: Move | undefined | null): MoveStyle {
  if (!move) return 'strike';
  if (move.power > 0) return 'strike';
  const atOther = (move.effects ?? []).some(
    (e) => e.type === 'status' || (e.type === 'stat' && e.target === 'opponent'),
  );
  return atOther ? 'hex' : 'boost';
}

/** Effects the scene spawns (pooled, see effects.ts and element-fx.ts). */
export type EffectKind =
  /** Wind-up: the element gathers round the attacker. */
  | 'charge'
  /** Element bits streaming behind a dashing fighter. */
  | 'trail'
  /** The element's burst where a hit lands, plus cartoon stars, a ring and speed lines. */
  | 'impact'
  /** A white pop where a hit lands (never with reduced motion). */
  | 'flash'
  /** A hex: a ball of the element flies from one fighter to the other. */
  | 'bolt'
  /** A boost: the element swirls up around a fighter. */
  | 'aura'
  /** Energy back: sparkles float up. */
  | 'sparkle'
  /** A stat going down: little grey puffs droop. */
  | 'droop'
  /** Dizzy: stars circle its head. */
  | 'dizzy'
  /** Sleepy: soft bubbles drift up. */
  | 'sleepy'
  /** Dust kicked up by a landing, a skid or a whiff. */
  | 'dust'
  /** The Heart Charm's throw, and its wobble on the ground. */
  | 'charm'
  /** Hearts and sparkles: a new friend, or a win. */
  | 'confetti';

export interface EffectCue {
  readonly kind: EffectKind;
  /** Whose squishy it's at (`bolt`: who it flies from). */
  readonly side: BattleSideId;
  readonly delay: number;
  /** The element whose look it takes (a move's), or null for its own. */
  readonly element: string | null;
  readonly strength: number;
  /** `charm`: true if the squishy wants to be friends. */
  readonly caught?: boolean;
}

export interface ActCue {
  readonly side: BattleSideId;
  readonly kind: ActKind;
  readonly delay: number;
  readonly ms: number;
  readonly strength: number;
}

export interface SquishCue {
  readonly side: BattleSideId;
  readonly move: SquishMove;
  readonly delay: number;
  readonly strength: number;
}

/** The camera for a step: who it frames, a push-in, a shake and a roll. */
export interface CameraCue {
  /** Lean the framing towards this fighter, or keep both in (null). */
  readonly focus: BattleSideId | null;
  /** 0 is the usual distance; 0.1 pushes in 10% closer. */
  readonly push: number;
  readonly pushDelay: number;
  /** Screen shake: how big (world units) and when. 0 for none. */
  readonly shake: number;
  readonly shakeDelay: number;
  /** A dutch roll on impact, radians (super hits only). */
  readonly roll: number;
}

export interface StepPlan {
  readonly acts: readonly ActCue[];
  readonly effects: readonly EffectCue[];
  readonly squish: readonly SquishCue[];
  readonly camera: CameraCue;
  /**
   * Hit-stop, ms: when a hit lands, both fighters hold their contact pose
   * this long before the knockback and follow-through (breathing and the
   * flash keep going).
   */
  readonly hitStop: number;
}

/** What the plan needs besides the step: the move being played and the player's settings. */
export interface PlanContext {
  /** The move the step is about (a hit's or an effect's comes from the last move played). */
  readonly move: Move | null;
  /** Who used it. */
  readonly user: BattleSideId | null;
  readonly mySide: BattleSideId;
  readonly reduced: boolean;
  /** At the end: the battle ended with a new friend. */
  readonly captured?: boolean;
}

const other = (side: BattleSideId): BattleSideId => (side === 'a' ? 'b' : 'a');

/** How hard a hit lands, from its effectiveness tier. */
export function hitStrength(tier: string | null): number {
  return CHOREO.strength[tier ?? 'normal'] ?? 1;
}

/** A super hit (the strongest tier): the big stars, the roll, the sky rays. */
export const SUPER_STRENGTH = CHOREO.strength['super'] ?? 1.45;

const camera = (c: Partial<CameraCue> = {}): CameraCue => ({
  focus: null,
  push: 0,
  pushDelay: 0,
  shake: 0,
  shakeDelay: 0,
  roll: 0,
  ...c,
});

/** The plan for one step of the log. `step.ms` bounds every act in it. */
export function planStep(step: PlaybackStep, ctx: PlanContext): StepPlan {
  const ms = step.ms;
  const { reduced } = ctx;
  const element = ctx.move?.element ?? null;
  const acts: ActCue[] = [];
  const effects: EffectCue[] = [];
  const squish: SquishCue[] = [];
  let cam = camera();
  let hitStop = 0;
  const act = (side: BattleSideId, kind: ActKind, delay = 0, len = ms - delay, strength = 1) =>
    acts.push({ side, kind, delay, ms: Math.max(1, len), strength });
  const fx = (kind: EffectKind, side: BattleSideId, delay = 0, extra: Partial<EffectCue> = {}) =>
    effects.push({ kind, side, delay, element, strength: 1, ...extra });

  switch (step.kind) {
    case 'move': {
      const style = moveStyle(ctx.move);
      if (style === 'strike') {
        act(step.side, 'dash');
        const { windup, travel } = CHOREO.dash;
        fx('charge', step.side, ms * 0.1);
        fx('trail', step.side, ms * windup, { strength: (ms * travel) / 1000 });
        fx('dust', step.side, ms * windup);
        cam = camera({ focus: step.side, push: reduced ? 0 : CHOREO_CAMERA.followPush });
      } else {
        act(step.side, 'cast');
        // The move goes out as the caster thrusts.
        if (style === 'hex') fx('bolt', step.side, ms * 0.4);
        else fx('aura', step.side, ms * 0.2);
        cam = camera({ focus: step.side });
      }
      break;
    }
    case 'hit': {
      const strength = hitStrength(step.effectiveness);
      const attacker = ctx.user ?? other(step.side);
      hitStop = reduced ? 0 : Math.round(CHOREO.hitStop * Math.min(1.5, strength));
      const after = ms - hitStop;
      const style = moveStyle(ctx.move);
      // A hex that hits (power 0 never does; a strike always dashed in).
      if (hitStop > 0) act(step.side, 'brace', 0, hitStop, strength);
      if (style === 'strike') act(attacker, 'follow', hitStop, after);
      act(step.side, 'knockback', hitStop, after, strength);
      if (!reduced) fx('flash', step.side, 0, { strength });
      fx('impact', step.side, hitStop, { strength });
      fx('dust', step.side, hitStop + after * 0.35);
      squish.push({
        side: step.side,
        move: 'wobble',
        delay: hitStop,
        strength: Math.min(1.5, strength),
      });
      cam = camera({
        focus: step.side,
        push: reduced ? 0 : CHOREO_CAMERA.hitPush * Math.min(1.4, strength),
        shake: reduced ? 0 : CHOREO_CAMERA.shake * strength,
        roll: reduced || strength < SUPER_STRENGTH ? 0 : CHOREO_CAMERA.roll,
      });
      break;
    }
    case 'miss': {
      // The miss's side is the one that missed.
      if (moveStyle(ctx.move) === 'strike') act(step.side, 'overshoot');
      act(other(step.side), 'dodge', 0, ms * 0.8);
      fx('dust', other(step.side), ms * 0.1);
      fx('dust', step.side, ms * 0.3);
      cam = camera({ focus: other(step.side) });
      break;
    }
    case 'heal':
      act(step.side, 'power-up', 0, ms * 0.9);
      fx('sparkle', step.side);
      squish.push({ side: step.side, move: 'bounce', delay: ms * 0.7, strength: 0.6 });
      cam = camera({ focus: step.side });
      break;
    case 'effect': {
      const up = step.squish === 'bounce';
      const status: EffectKind = step.status ?? 'droop';
      if (up) {
        act(step.side, 'power-up', 0, ms * 0.9);
        fx('aura', step.side);
      } else if (step.squish === 'jiggle') {
        // A stat going down, or a status taking hold.
        act(step.side, 'shiver', 0, ms * 0.6);
        fx(status, step.side);
        squish.push({ side: step.side, move: 'jiggle', delay: 0, strength: 0.8 });
      } else {
        // Too dizzy or sleepy to move: the status shows again.
        fx(status, step.side);
      }
      cam = camera({ focus: step.side });
      break;
    }
    case 'tuckered':
      act(step.side, 'faint');
      fx('dizzy', step.side, ms * 0.6);
      fx('dust', step.side, ms * 0.65);
      cam = camera({
        focus: step.side,
        push: reduced ? 0 : CHOREO_CAMERA.koPush,
        pushDelay: ms * 0.5,
        shake: reduced ? 0 : CHOREO_CAMERA.shake * 0.5,
        shakeDelay: ms * 0.7,
      });
      break;
    case 'swap':
      // Out goes the old squishy, in comes the new one (`to`).
      if (step.to !== null && step.to !== step.slot) {
        act(step.side, 'swap-out', 0, ms * CHOREO.swap.out);
        act(step.side, 'swap-in', ms * CHOREO.swap.out, ms * (1 - CHOREO.swap.out));
        fx('dust', step.side, ms * (CHOREO.swap.out + (1 - CHOREO.swap.out) * 0.45));
      } else {
        act(step.side, 'swap-in');
        fx('dust', step.side, ms * 0.45);
      }
      cam = camera({ focus: step.side });
      break;
    case 'capture': {
      // The Heart Charm is thrown from the player's side, draws the wild
      // squishy in, wobbles, and then a friend pops out happy, or it wiggles free.
      const caught = step.squish === 'bounce';
      const { throwAt, wobbleAt, resultAt } = CHOREO.charm;
      fx('charm', step.side, 0, { caught, element: null });
      act(step.side, 'charmed', ms * throwAt, ms * (wobbleAt - throwAt));
      act(step.side, 'pop-out', ms * resultAt, ms * (1 - resultAt));
      if (caught) fx('confetti', step.side, ms * resultAt, { element: null });
      else fx('dust', step.side, ms * resultAt);
      squish.push({
        side: step.side,
        move: caught ? 'bounce' : 'wobble',
        delay: ms * resultAt,
        strength: 1,
      });
      cam = camera({ focus: step.side, push: reduced ? 0 : CHOREO_CAMERA.followPush });
      break;
    }
    case 'forfeit':
      act(step.side, 'scoot');
      fx('dust', step.side, ms * 0.25);
      cam = camera({ focus: other(step.side) });
      break;
    case 'end': {
      const won = step.squish === 'bounce';
      if (won) {
        act(step.side, 'victory');
        fx('confetti', step.side, ms * 0.2, { element: null });
        squish.push({ side: step.side, move: 'bounce', delay: 0, strength: 0.8 });
      }
      // A new friend bounces along; anyone else is a little dizzy.
      if (won && ctx.captured) {
        squish.push({ side: other(step.side), move: 'bounce', delay: 0, strength: 0.6 });
      }
      cam = camera({ focus: won ? step.side : null });
      break;
    }
  }
  return { acts, effects, squish, camera: cam, hitStop };
}
