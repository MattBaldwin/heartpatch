import type { SpotInteraction } from '@heartpatch/shared';
import { INTERACTION } from './explore-config.js';

/*
 * The touch mini-interactions (#199, owner design 2026-10-07): swipe down
 * to dig, tap left and right to climb, sweep a light round a cave, swipe a
 * net through the water when it glows, hold to lift a rock, wiggle to shake
 * a tree. They're feel, not outcome: the server rolls every find (CLAUDE.md
 * rule 1). Every one has an easy way (a tap or a hold) so nobody gets stuck.
 * Pure reducers fed with pointer samples and times, so each is unit-tested.
 */

/** Where the interaction is drawn, CSS pixels. */
export interface StageSize {
  readonly width: number;
  readonly height: number;
}

export type InteractionInput =
  /** A finger landed, moved or lifted on the interaction's stage (CSS pixels, ms). */
  | {
      readonly type: 'down' | 'move' | 'up';
      readonly x: number;
      readonly y: number;
      readonly t: number;
    }
  /** The easy-way button was tapped. */
  | { readonly type: 'easy'; readonly t: number }
  /** The easy-way button was pressed or let go (holding it hikes up). */
  | { readonly type: 'easy-down' | 'easy-up'; readonly t: number }
  /** The Walking Stick's left or right step. */
  | { readonly type: 'side'; readonly side: 'left' | 'right'; readonly t: number }
  /** Time passed (holds fill up). */
  | { readonly type: 'tick'; readonly t: number };

export interface InteractionState {
  readonly kind: SpotInteraction;
  readonly stage: StageSize;
  /** Steps done (scoops, climbs, shakes) and how many make it. */
  readonly count: number;
  readonly need: number;
  /** A press or hold that's still on: since when, or null. */
  readonly holdSince: number | null;
  /** How long the hold has lasted so far, ms (the fill shows it). */
  readonly held: number;
  /** The stroke the finger is drawing now, or null. */
  readonly stroke: Stroke | null;
  readonly lastSide: 'left' | 'right' | null;
  /** Lantern: where the light is, the glint, and whether the light has found it. */
  readonly light: { readonly x: number; readonly y: number } | null;
  readonly glint: { readonly x: number; readonly y: number };
  readonly revealed: boolean;
  /** Snorkel: when the glow cycle started, and whether the scoop was well timed. */
  readonly startedAt: number;
  readonly bigSplash: boolean;
  readonly done: boolean;
}

interface Stroke {
  readonly x0: number;
  readonly y0: number;
  /** This stroke already counted (one scoop per swipe). */
  readonly counted: boolean;
  /** Shake: the way the finger is going (-1 left, 1 right, 0 not yet), and how far it got. */
  readonly dir: number;
  readonly turnX: number;
}

/**
 * A fresh interaction for a spot. `seed01` (0–1) places the lantern's glint,
 * so the same spot hides it in the same place every time it's drawn.
 */
export function startInteraction(
  kind: SpotInteraction,
  stage: StageSize,
  t: number,
  seed01 = 0.5,
): InteractionState {
  const need =
    kind === 'dig'
      ? INTERACTION.digScoops
      : kind === 'climb'
        ? INTERACTION.climbSteps
        : kind === 'shake'
          ? INTERACTION.shakes
          : 1;
  const angle = seed01 * Math.PI * 2;
  return {
    kind,
    stage,
    count: 0,
    need,
    holdSince: null,
    held: 0,
    stroke: null,
    lastSide: null,
    light: null,
    glint: {
      x: stage.width * (0.5 + Math.cos(angle) * 0.28),
      y: stage.height * (0.5 + Math.sin(angle) * 0.22),
    },
    revealed: false,
    startedAt: t,
    bigSplash: false,
    done: false,
  };
}

/** How far along it is, 0–1 (the progress ring). */
export function interactionProgress(s: InteractionState): number {
  if (s.done) return 1;
  if (s.kind === 'lift' || (s.kind === 'climb' && s.holdSince !== null)) {
    const hold = Math.min(1, s.held / INTERACTION.holdMs);
    return s.kind === 'climb' ? Math.max(s.count / s.need, hold) : hold;
  }
  if (s.kind === 'light') return s.revealed ? 0.5 : 0;
  return Math.min(1, s.count / s.need);
}

/** The water glows now (a scoop then makes a bigger splash; any scoop works). */
export function netGlowing(s: InteractionState, t: number): boolean {
  const phase =
    (((t - s.startedAt) % INTERACTION.netCycleMs) + INTERACTION.netCycleMs) %
    INTERACTION.netCycleMs;
  return phase < INTERACTION.netGlowMs;
}

/** The lantern's light reaches this point (CSS pixels). */
export function lit(s: InteractionState, x: number, y: number): boolean {
  if (s.revealed && s.light === null) return true; // the easy way lit the whole cave
  if (!s.light) return false;
  const r = INTERACTION.lightRadius * s.stage.width;
  return (s.light.x - x) ** 2 + (s.light.y - y) ** 2 <= r * r;
}

export function stepInteraction(s: InteractionState, input: InteractionInput): InteractionState {
  if (s.done) return s;
  switch (s.kind) {
    case 'dig':
      return dig(s, input);
    case 'climb':
      return climb(s, input);
    case 'light':
      return light(s, input);
    case 'scoop':
      return scoop(s, input);
    case 'lift':
      return lift(s, input);
    case 'shake':
      return shake(s, input);
  }
}

/** One more step; done once there are enough. */
function counted(s: InteractionState, n = 1): InteractionState {
  const count = Math.min(s.need, s.count + n);
  return { ...s, count, done: count >= s.need };
}

/** Shovel: each swipe down is a scoop; so is each tap on "Tap to dig". */
function dig(s: InteractionState, input: InteractionInput): InteractionState {
  switch (input.type) {
    case 'easy':
      return counted(s);
    case 'down':
      return { ...s, stroke: { x0: input.x, y0: input.y, counted: false, dir: 0, turnX: input.x } };
    case 'move': {
      const stroke = s.stroke;
      if (!stroke || stroke.counted || input.y - stroke.y0 < INTERACTION.swipePx) return s;
      return counted({ ...s, stroke: { ...stroke, counted: true } });
    }
    case 'up':
      return { ...s, stroke: null };
    default:
      return s;
  }
}

/**
 * Walking Stick: left, right, left, right. Any tap on the easy button counts as a
 * step too, and holding it climbs all the way ("You can't fall!").
 */
function climb(s: InteractionState, input: InteractionInput): InteractionState {
  switch (input.type) {
    case 'side':
      if (s.lastSide === input.side) return s;
      return counted({ ...s, lastSide: input.side });
    case 'easy':
      return counted(s);
    case 'easy-down':
      return { ...s, holdSince: input.t, held: 0 };
    case 'easy-up':
      return { ...s, holdSince: null, held: 0 };
    case 'tick': {
      if (s.holdSince === null) return s;
      const held = input.t - s.holdSince;
      return held >= INTERACTION.holdMs
        ? { ...s, held, count: s.need, done: true }
        : { ...s, held };
    }
    default:
      return s;
  }
}

/**
 * Lantern: the light follows the finger round the dark cave; once it falls
 * on the glint, tap the glint. The easy way lights the whole cave.
 */
function light(s: InteractionState, input: InteractionInput): InteractionState {
  const near = (x: number, y: number) => {
    const r = INTERACTION.lightRadius * s.stage.width;
    return (s.glint.x - x) ** 2 + (s.glint.y - y) ** 2 <= r * r;
  };
  switch (input.type) {
    case 'easy':
      return { ...s, light: null, revealed: true };
    case 'down':
      if (s.revealed && near(input.x, input.y)) return { ...s, count: 1, done: true };
      return {
        ...s,
        light: { x: input.x, y: input.y },
        revealed: s.revealed || near(input.x, input.y),
      };
    case 'move':
      if (s.light === null && s.revealed) return s;
      return {
        ...s,
        light: { x: input.x, y: input.y },
        revealed: s.revealed || near(input.x, input.y),
      };
    default:
      return s;
  }
}

/** Snorkel: a swipe through the water scoops; while it glows, the splash is bigger. */
function scoop(s: InteractionState, input: InteractionInput): InteractionState {
  switch (input.type) {
    case 'easy':
      return { ...s, count: 1, done: true, bigSplash: netGlowing(s, input.t) };
    case 'down':
      return { ...s, stroke: { x0: input.x, y0: input.y, counted: false, dir: 0, turnX: input.x } };
    case 'move': {
      const stroke = s.stroke;
      if (!stroke) return s;
      const dx = input.x - stroke.x0;
      const dy = input.y - stroke.y0;
      if (dx * dx + dy * dy < INTERACTION.swipePx * INTERACTION.swipePx) return s;
      return { ...s, stroke: null, count: 1, done: true, bigSplash: netGlowing(s, input.t) };
    }
    case 'up':
      return { ...s, stroke: null };
    default:
      return s;
  }
}

/** Hands on a rock or log: hold to lift it. The easy way is one tap. */
function lift(s: InteractionState, input: InteractionInput): InteractionState {
  switch (input.type) {
    case 'easy':
      return { ...s, count: 1, done: true };
    case 'down':
      return { ...s, holdSince: input.t, held: 0 };
    case 'up':
      return { ...s, holdSince: null, held: 0 };
    case 'tick':
    case 'move': {
      if (s.holdSince === null) return s;
      const held = input.t - s.holdSince;
      return held >= INTERACTION.holdMs ? { ...s, held, count: 1, done: true } : { ...s, held };
    }
    default:
      return s;
  }
}

/** Hands on a tree or flower bed: wiggle left and right. The easy way is one tap. */
function shake(s: InteractionState, input: InteractionInput): InteractionState {
  switch (input.type) {
    case 'easy':
      return { ...s, count: s.need, done: true };
    case 'down':
      return { ...s, stroke: { x0: input.x, y0: input.y, counted: false, dir: 0, turnX: input.x } };
    case 'move': {
      const stroke = s.stroke;
      if (!stroke) return s;
      const half = INTERACTION.swipePx / 2;
      const moved = input.x - stroke.turnX;
      if (stroke.dir === 0) {
        if (Math.abs(moved) < half) return s;
        return { ...s, stroke: { ...stroke, dir: Math.sign(moved), turnX: input.x } };
      }
      // Still going the same way: the turning point follows the finger.
      if (Math.sign(moved) === stroke.dir || moved === 0) {
        return { ...s, stroke: { ...stroke, turnX: input.x } };
      }
      if (Math.abs(moved) < half) return s;
      return counted({ ...s, stroke: { ...stroke, dir: -stroke.dir, turnX: input.x } });
    }
    case 'up':
      return { ...s, stroke: null };
    default:
      return s;
  }
}
