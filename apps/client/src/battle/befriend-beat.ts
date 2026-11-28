import { el } from '../ui/dom.js';
import { BEFRIEND_BEAT } from './battle-config.js';
import type { BattleClock } from './battle-clock.js';
import { sparkleSpots, type RevealLayout } from './rare-reveal.js';
import './befriend-beat.css';

/*
 * The answer to an ask (#190 PR 6): a blush and hearts that grow with the
 * boss's coarse warmth, and for a yes a sparkle where the BIG squishy
 * shrinks to its base form (the dim pattern of rare-reveal.ts). The cue is a
 * pure function of the warmth step; no number or odds ever reach the page
 * (CLAUDE.md rule 6). Page elements only: transform and opacity move.
 */

export interface WarmthCue {
  /** How many heart bursts rise from the boss (the scene's `confetti`). */
  readonly bursts: number;
  /** The cheeks' pink, 0–1. */
  readonly blush: number;
}

/** The cue for a warmth step (0–`BOSS_WARMTH_STEPS`); out of range holds at the ends. */
export function warmthCue(warmth: number): WarmthCue {
  const i = Math.min(BEFRIEND_BEAT.bursts.length - 1, Math.max(0, Math.round(warmth)));
  const bursts: readonly number[] = BEFRIEND_BEAT.bursts;
  const blush: readonly number[] = BEFRIEND_BEAT.blush;
  return { bursts: bursts[i] ?? 1, blush: blush[i] ?? 0.2 };
}

export interface BefriendBeatOptions {
  readonly answer: 'yes' | 'not-yet';
  readonly warmth: number;
  readonly layout: RevealLayout;
  readonly reducedMotion: boolean;
  readonly clock: BattleClock;
}

/** What the page shows for an answer, as plain numbers (so it's testable without a DOM). */
export interface BeatPlan {
  readonly ms: number;
  readonly spot: { x: number; y: number; r: number };
  /** The blush glow's strongest opacity. */
  readonly blush: number;
  /** A yes dims around the boss; a not-yet doesn't. */
  readonly dim: boolean;
  /** A yes sparkles (never with reduced motion). */
  readonly sparkles: ReturnType<typeof sparkleSpots>;
}

export function beatPlan(options: Omit<BefriendBeatOptions, 'clock'>): BeatPlan {
  const { layout, reducedMotion } = options;
  const spot = layout.spot ?? {
    x: layout.width / 2,
    y: (layout.pillsBottom + layout.sheetTop) / 2,
    r: Math.min(layout.width, layout.height) / 5,
  };
  const yes = options.answer === 'yes';
  return {
    ms: reducedMotion ? BEFRIEND_BEAT.calmMs : BEFRIEND_BEAT.ms,
    spot,
    blush: warmthCue(options.warmth).blush * BEFRIEND_BEAT.blushMax,
    dim: yes,
    sparkles:
      yes && !reducedMotion
        ? sparkleSpots(BEFRIEND_BEAT.sparkles, { ...layout, spot }, Math.round(layout.width) + 17)
        : [],
  };
}

export interface BefriendBeat {
  readonly element: HTMLElement;
  /** Takes it away now (the battle closed, or the next answer came). */
  dispose: () => void;
}

/** Puts the beat on screen inside `host`; it removes itself when it ends. */
export function showBefriendBeat(host: HTMLElement, options: BefriendBeatOptions): BefriendBeat {
  const plan = beatPlan(options);
  const { spot } = plan;
  const root = el('div', {
    class: `befriend-beat${options.reducedMotion ? ' befriend-beat-calm' : ''}`,
    'aria-hidden': 'true',
  });
  root.style.setProperty('--beat-ms', `${String(plan.ms)}ms`);
  const place = (node: HTMLElement, radius: number): void => {
    node.style.setProperty('--beat-x', `${String(Math.round(spot.x))}px`);
    node.style.setProperty('--beat-y', `${String(Math.round(spot.y))}px`);
    node.style.setProperty('--beat-r', `${String(Math.round(spot.r * radius))}px`);
  };
  const glow = el('div', { class: 'befriend-blush' });
  place(glow, 1.4);
  glow.style.setProperty('--beat-blush', String(plan.blush));
  root.append(glow);
  if (plan.dim) {
    const dim = el('div', { class: 'befriend-dim' });
    place(dim, 1.9);
    dim.style.setProperty('--beat-dim', String(BEFRIEND_BEAT.dim));
    root.append(dim);
  }
  for (const s of plan.sparkles) {
    const sparkle = el('span', { class: 'befriend-sparkle' }, s.glyph);
    sparkle.style.left = `${String(Math.round(spot.x))}px`;
    sparkle.style.top = `${String(Math.round(spot.y))}px`;
    sparkle.style.setProperty('--dx', `${String(s.dx)}px`);
    sparkle.style.setProperty('--dy', `${String(s.dy)}px`);
    sparkle.style.setProperty('--rot', `${String(s.rot)}deg`);
    sparkle.style.fontSize = `${String(s.size)}px`;
    if (s.tint) sparkle.classList.add('befriend-sparkle-tint');
    root.append(sparkle);
  }
  host.append(root);
  let done = false;
  const dispose = (): void => {
    if (done) return;
    done = true;
    options.clock.cancel(timer);
    root.remove();
  };
  const timer = options.clock.later(plan.ms, dispose);
  return { element: root, dispose };
}
