import type { BattleSideId, PlayerBattle } from '@heartpatch/shared';
import type { BattleClock } from './battle-clock.js';
import type { PlaybackStep } from './battle-playback.js';
import { isTeamBattle } from './boss-view.js';
import './boss-entrance.css';

// The BIG squishy arrives (#190 PR 3): every boss fight opens with the boss
// dropping in, a stomp (the landing thump's sound, push and buzz), its name
// card, and a settle into the fight's rest framing. One continuous low camera,
// no cuts (owner decision 3). The timeline is a pure function of `t`; the
// scene poses the boss from it and the screen draws the card from it.

/** The entrance's beats, ms from its start. */
export const BOSS_ENTRANCE = {
  /** The whole entrance (owner decision 2). */
  totalMs: 2600,
  /** The boss's feet touch down: the stomp. Nothing can skip before it (the plan's 0.6 s rule). */
  stompMs: 600, // TUNE:
  /** How high the boss starts, in world units above its spot (off the top of the band). */
  dropHeight: 7, // TUNE:
  /** The stomp's squash, then the wobble back to round. */
  squashDepth: 0.32, // TUNE:
  squashMs: 420, // TUNE:
  /** The name card pops in, holds, then fades. */
  cardInMs: 800, // TUNE:
  cardFadeMs: 220, // TUNE:
  cardOutMs: 2200, // TUNE:
  /** The fight's rest framing from here on (the card is gone). */
  settleMs: 2420, // TUNE:
  /** The card's pop: from this size up to 1 as it fades in (not under reduced motion). */
  cardPopFrom: 0.86, // TUNE:
  /** The boss's head and tuft over its face, in face-heights (the card stays clear of it). */
  headroom: 1.5, // TUNE:
  /** The card's gap from the boss's face and the team's eyes, px. */
  cardGapPx: 10, // TUNE:
} as const;

export type EntrancePhase = 'arrive' | 'stomp' | 'card' | 'settled' | 'done';

export interface EntranceState {
  readonly phase: EntrancePhase;
  /** World units above the boss's spot (0 on the ground). */
  readonly lift: number;
  /** Height scale for the stomp (1 is round). */
  readonly squash: number;
  /** The name card's opacity (0 hidden) and size. */
  readonly card: number;
  readonly cardScale: number;
  /** A tap skips from here on (after the stomp lands). */
  readonly skippable: boolean;
  readonly done: boolean;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The entrance at `t` ms from its start. Pure: the same `t` (and motion
 * setting) is always the same state. Reduced motion keeps every beat (the
 * stomp's sound, the card, the skip) but the boss is simply there: no drop,
 * no squash.
 */
export function entranceAt(t: number, reducedMotion = false): EntranceState {
  const e = BOSS_ENTRANCE;
  const phase: EntrancePhase =
    t >= e.totalMs
      ? 'done'
      : t >= e.settleMs
        ? 'settled'
        : t >= e.cardInMs
          ? 'card'
          : t >= e.stompMs
            ? 'stomp'
            : 'arrive';
  // Falling: slow at the top, fastest as it lands (ease-in).
  const fall = clamp01(t / e.stompMs);
  const lift = reducedMotion || t >= e.stompMs ? 0 : e.dropHeight * (1 - fall * fall);
  // The stomp: squashed flat on landing, wobbling back to round.
  const since = t - e.stompMs;
  const squash =
    reducedMotion || since < 0 || since >= e.squashMs
      ? 1
      : 1 -
        e.squashDepth * (1 - since / e.squashMs) * Math.cos((since / e.squashMs) * Math.PI * 1.5);
  const fadeIn = clamp01((t - e.cardInMs) / e.cardFadeMs);
  const fadeOut = clamp01((e.cardOutMs + e.cardFadeMs - t) / e.cardFadeMs);
  const card = t >= e.totalMs ? 0 : Math.min(fadeIn, fadeOut);
  const cardScale = reducedMotion ? 1 : e.cardPopFrom + (1 - e.cardPopFrom) * fadeIn;
  return {
    phase,
    lift,
    squash,
    card,
    cardScale,
    skippable: t >= e.stompMs && t < e.totalMs,
    done: t >= e.totalMs,
  };
}

/**
 * True when opening `b` starts with the entrance: a boss fight (a team
 * battle) at its very start, every fight (owner decision 2). Never a
 * one-on-one battle, a replay, or a fight already under way (a reload).
 */
export function wantsEntrance(b: Pick<PlayerBattle, 'view' | 'status'>, replay: boolean): boolean {
  return isTeamBattle(b) && !replay && b.status === 'active' && b.view.log.length === 0;
}

/**
 * The stomp as a step of the log, for the screen's beat hook (`onStep` with
 * a `landing` beat: the boss's landing cue and the Android buzz, #190 PR 4).
 * The team's side is hit by the thump, as when a windup lands.
 */
export function stompStep(teamSide: BattleSideId): PlaybackStep {
  return {
    kind: 'hit',
    side: teamSide,
    slot: 0,
    text: '',
    ms: 0,
    callout: null,
    squish: null,
    energy: null,
    to: null,
    move: null,
    effectiveness: null,
    status: null,
    item: null,
    shielded: false,
    stance: null,
  };
}

/** True when the stomp lands between two frames' `t`s (its sound and thump fire once). */
export function stompedBetween(before: number, after: number): boolean {
  return before < BOSS_ENTRANCE.stompMs && after >= BOSS_ENTRANCE.stompMs;
}

/** The name card's words (STYLE_GUIDE: short, kid-readable). */
export function entranceCard(bossName: string): { readonly title: string; readonly name: string } {
  return { title: 'A BIG squishy!', name: `${bossName} stomps in!` };
}

/** Where the boss's face and the team's eyes are, fractions of the height from the top. */
export interface CardLayout {
  /** The stage band between the top strip and the sheet's handle. */
  readonly band: { readonly top: number; readonly bottom: number };
  /** The boss's face box, or null when the scene hasn't framed it yet. */
  readonly face: { readonly top: number; readonly bottom: number } | null;
  /** The highest of the team's eyes, or null. */
  readonly teamTop: number | null;
  /** The viewport height, px, and the card's height, px. */
  readonly height: number;
  readonly cardHeight: number;
}

/**
 * The card's top, px, never over the boss's face or the team's eyes, inside
 * the band: first in the sky over the boss's head (the face's top less
 * `headroom` face-heights for the head and its tuft), else in the gap between
 * the face and the team (over its tummy), else just under the face.
 */
export function cardTop(layout: CardLayout): number {
  const { band, face, teamTop, height, cardHeight } = layout;
  const gap = BOSS_ENTRANCE.cardGapPx;
  const lo = band.top * height + gap;
  const hi = band.bottom * height - cardHeight - gap;
  const place = (want: number): number => Math.round(Math.max(lo, Math.min(hi, want)));
  if (!face) return place((lo + hi) / 2);
  const faceTop = face.top * height;
  const faceBottom = face.bottom * height;
  const headTop = faceTop - (faceBottom - faceTop) * BOSS_ENTRANCE.headroom;
  const skyBottom = headTop - gap - cardHeight;
  if (skyBottom >= lo) return place((lo + skyBottom) / 2);
  const from = faceBottom + gap;
  const to = teamTop !== null ? teamTop * height - cardHeight - gap : hi;
  return place(to >= from ? (from + to) / 2 : from);
}

/**
 * Holds the fight's playback until the entrance is over (`playNext` waits
 * for it). `run` runs `fn` now when no entrance is on, else once it ends,
 * skipped or not; `end` lets the held work go, once.
 */
export class EntranceGate {
  #open = true;
  #held: (() => void)[] = [];

  get waiting(): boolean {
    return !this.#open;
  }

  hold(): void {
    this.#open = false;
  }

  run(fn: () => void): void {
    if (this.#open) fn();
    else this.#held.push(fn);
  }

  end(): void {
    if (this.#open) return;
    this.#open = true;
    const held = this.#held;
    this.#held = [];
    for (const fn of held) fn();
  }

  /** Forgets the held work (the battle closed). */
  drop(): void {
    this.#open = true;
    this.#held = [];
  }
}

export interface EntranceOptions {
  readonly bossName: string;
  readonly reducedMotion: boolean;
  readonly clock: BattleClock;
  /** The boss's face and the team's eyes as the scene framed them this frame. */
  readonly layout: () => Omit<CardLayout, 'cardHeight'>;
  /** The scene's pose for the boss each frame. */
  readonly pose: (state: EntranceState) => void;
  /** The stomp lands (the landing cue, push and buzz). */
  readonly onStomp: () => void;
  /** The entrance ended, skipped or not (not called after `dispose`). */
  readonly onDone: () => void;
}

export interface BossEntrance {
  readonly element: HTMLElement;
  /** The entrance's `t` now, ms (the dev hook). */
  readonly at: () => number;
  /** A tap skips now (the stomp has landed). */
  readonly skippable: () => boolean;
  /** Skips to the end (a tap; ignored before the stomp). Returns true when it skipped. */
  skip: () => boolean;
  dispose: () => void;
}

/** Puts the entrance up over the battle and plays it on `clock`'s time. */
export function showBossEntrance(host: HTMLElement, options: EntranceOptions): BossEntrance {
  const { clock, reducedMotion } = options;
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  const root = doc.createElement('div');
  root.className = 'boss-entrance';
  if (reducedMotion) root.classList.add('boss-entrance-still');
  const card = doc.createElement('div');
  card.className = 'boss-entrance-card';
  card.setAttribute('role', 'status');
  const words = entranceCard(options.bossName);
  const title = doc.createElement('div');
  title.className = 'boss-entrance-title';
  title.textContent = words.title;
  const name = doc.createElement('div');
  name.className = 'boss-entrance-name';
  name.textContent = words.name;
  card.append(title, name);
  const hint = doc.createElement('div');
  hint.className = 'boss-entrance-skip';
  hint.textContent = 'Tap to skip';
  root.append(card, hint);
  host.append(root);

  const start = clock.now();
  let last = -1;
  let done = false;
  let frame = 0;
  const at = (): number => clock.now() - start;
  const finish = (notify: boolean): void => {
    if (done) return;
    done = true;
    if (frame !== 0) view?.cancelAnimationFrame(frame);
    root.remove();
    options.pose(entranceAt(BOSS_ENTRANCE.totalMs, reducedMotion));
    if (notify) options.onDone();
  };
  const draw = (): void => {
    frame = 0;
    if (done) return;
    const t = at();
    const state = entranceAt(t, reducedMotion);
    if (stompedBetween(last, t)) options.onStomp();
    last = t;
    if (state.done) {
      finish(true);
      return;
    }
    options.pose(state);
    if (state.card > 0) {
      const box = options.layout();
      const top = cardTop({ ...box, cardHeight: card.offsetHeight || 64 });
      card.style.transform = `translate(-50%, ${top}px) scale(${state.cardScale})`;
    }
    card.style.opacity = String(state.card);
    root.classList.toggle('boss-entrance-skippable', state.skippable);
    frame = view?.requestAnimationFrame(draw) ?? 0;
  };
  // A tap after the stomp skips; the click the browser sends after the lift
  // is swallowed so it can't land on the picker the end brings back.
  const swallow = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const skip = (): boolean => {
    if (done || !entranceAt(at(), reducedMotion).skippable) return false;
    finish(true);
    return true;
  };
  const tap = (): void => {
    if (!skip()) return;
    doc.addEventListener('click', swallow, { capture: true, once: true });
    view?.setTimeout(() => {
      doc.removeEventListener('click', swallow, { capture: true });
    }, 400);
  };
  root.addEventListener('pointerup', tap);
  root.addEventListener('click', (event) => {
    swallow(event);
    skip();
  });
  draw();
  return {
    element: root,
    at,
    skippable: () => !done && entranceAt(at(), reducedMotion).skippable,
    skip,
    dispose: () => {
      finish(false);
    },
  };
}
