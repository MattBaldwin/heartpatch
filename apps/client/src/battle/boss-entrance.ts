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
  /** How long the click after a skipping tap's lift is swallowed, ms (as `RARE_REVEAL.clickGraceMs`). */
  clickGraceMs: 350, // TUNE:
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
 * The card's top, px, inside the band and never over the boss's face or the
 * team's eyes. In order: the sky over the boss's head (the face's top less
 * `headroom` face-heights for the head and its tuft), the gap between the face
 * and the team (over its tummy), the band's top, the band's bottom. When no
 * spot is clear of both (a band too short for it), the band's top: the card
 * fades in 0.2 s later and is gone by 2.4 s, and the face is the one thing it
 * must not hide, so it never goes below the face's top there.
 */
export function cardTop(layout: CardLayout): number {
  const { band, face, teamTop, height, cardHeight } = layout;
  const gap = BOSS_ENTRANCE.cardGapPx;
  const lo = band.top * height + gap;
  const hi = band.bottom * height - cardHeight - gap;
  const place = (want: number): number => Math.max(lo, Math.min(hi, want));
  if (!face) return place((lo + hi) / 2);
  const faceTop = face.top * height;
  const faceBottom = face.bottom * height;
  const headTop = faceTop - (faceBottom - faceTop) * BOSS_ENTRANCE.headroom;
  const team = teamTop !== null ? teamTop * height : Number.POSITIVE_INFINITY;
  /** Clear of the face and the team's eyes (each with the gap). */
  const clear = (top: number): boolean => {
    const bottom = top + cardHeight;
    const offFace = bottom + gap <= faceTop || top >= faceBottom + gap;
    return offFace && bottom + gap <= team;
  };
  const skyBottom = headTop - gap - cardHeight;
  const tummyTo = Math.min(team - gap, band.bottom * height - gap) - cardHeight;
  const candidates = [
    skyBottom >= lo ? place((lo + skyBottom) / 2) : null,
    tummyTo >= faceBottom + gap ? place((faceBottom + gap + tummyTo) / 2) : null,
    place(lo),
    place(hi),
  ];
  for (const top of candidates) if (top !== null && clear(top)) return top;
  return place(lo);
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
  const name = doc.createElement('div');
  name.className = 'boss-entrance-name';
  card.append(title, name);
  const hint = doc.createElement('div');
  hint.className = 'boss-entrance-skip';
  hint.textContent = 'Tap to skip';
  root.append(card, hint);
  host.append(root);
  // Words after the card is in the page, so a screen reader announces the status.
  title.textContent = words.title;
  name.textContent = words.name;

  const start = clock.now();
  let last = -1;
  let done = false;
  let frame = 0;
  let cardHeight = 0;
  /** A finger is down on the layer; `due`: the entrance ran out meanwhile (it ends on the lift). */
  let pressed = false;
  let due = false;
  const at = (): number => clock.now() - start;
  const finish = (notify: boolean): void => {
    if (done) return;
    done = true;
    if (frame !== 0) view?.cancelAnimationFrame(frame);
    doc.removeEventListener('keydown', onKey, true);
    root.remove();
    options.pose(entranceAt(BOSS_ENTRANCE.totalMs, reducedMotion));
    if (notify) options.onDone();
  };
  const draw = (): void => {
    frame = 0;
    if (done) return;
    const t = at();
    const state = entranceAt(t, reducedMotion);
    // Back from a hidden tab past the end: no lone stomp, it just ends.
    if (stompedBetween(last, t) && !state.done) options.onStomp();
    last = t;
    if (state.done) {
      // Ends on time, unless a tap is halfway through: then when that tap lifts.
      if (pressed) {
        due = true;
        options.pose(state);
        card.style.opacity = '0';
      } else finish(true);
      return;
    }
    options.pose(state);
    if (state.card > 0) {
      const box = options.layout();
      // Measured once, when it first shows (its words never change): not a layout read per frame.
      if (cardHeight === 0) cardHeight = card.offsetHeight || 64;
      const top = cardTop({ ...box, cardHeight });
      card.style.transform = `translate(-50%, ${top}px) scale(${state.cardScale})`;
    }
    card.style.opacity = String(state.card);
    root.classList.toggle('boss-entrance-skippable', state.skippable);
    frame = view?.requestAnimationFrame(draw) ?? 0;
  };
  const skippable = (): boolean => !done && (due || entranceAt(at(), reducedMotion).skippable);
  const skip = (): boolean => {
    if (!skippable()) return false;
    finish(true);
    return true;
  };
  // As the rare find's moment (rare-reveal.ts): a skip ends as the finger
  // lifts, and the click the browser sends right after is swallowed before it
  // reaches the picker the end uncovers. Nothing calls preventDefault on the
  // press: WebKit then sends no click at all, so a skip must not wait for one.
  const swallow = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const press = (): void => {
    pressed = true;
  };
  const lift = (): void => {
    if (!pressed) return;
    pressed = false;
    if (!skippable()) return;
    // Disarmed by the next press anywhere, or soon after: a lift with no click
    // (a long press) must not eat the kid's next real tap.
    const disarm = (): void => {
      doc.removeEventListener('click', swallow, { capture: true });
      doc.removeEventListener('pointerdown', disarm, { capture: true });
    };
    doc.addEventListener('click', swallow, { capture: true, once: true });
    doc.addEventListener('pointerdown', disarm, { capture: true, once: true });
    view?.setTimeout(disarm, BOSS_ENTRANCE.clickGraceMs);
    finish(true);
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
    // Typing in a text box (chat) is typing, not a skip.
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    ) {
      return;
    }
    if (!skippable()) return;
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  }
  // Pointer events, and touch events too: whichever the browser sends first.
  root.addEventListener('pointerdown', press);
  root.addEventListener('touchstart', press, { passive: true });
  root.addEventListener('pointerup', lift);
  root.addEventListener('touchend', lift);
  root.addEventListener('pointercancel', () => {
    pressed = false;
    if (due) finish(true);
  });
  // A click with no press seen (a screen reader's tap) skips too, after the stomp.
  root.addEventListener('click', (event) => {
    swallow(event);
    skip();
  });
  doc.addEventListener('keydown', onKey, true);
  draw();
  return {
    element: root,
    at,
    skippable,
    skip,
    dispose: () => {
      finish(false);
    },
  };
}
