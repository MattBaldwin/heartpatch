import { el } from '../../ui/dom.js';
import type { CueName } from '../../audio/cues.js';
import { CROOKED_ECHO_TEXT as E, CROOKED_TEXT as T } from './crooked-text.js';
import './crooked-peekaboo.css';

// The peekaboo (#306 6d, owner decision 3): an echo caught me stepping into
// its room. The screen goes dark, two eyes blink open, a low sting and a
// shake with "Peekaboo! 👻", then the dark lifts on the last lit room and
// the echo turns out to be friendly: it waves and giggles, and the card says
// nothing is lost. Reduced motion: a gentle fade, no blink, no pop, no
// shake; the same words and the same friendly echo. A deliberate exception
// to the style guide's "no jump scares" (the owner's call), so it stays a
// playful boo: no teeth, no lunge at the camera, and over in two seconds.
//
// The timeline is pure (`peekFrame`, `peekBeats`) so it's tested, and a
// still capture can stop its clock (`hold`).

export type PeekPhase = 'dark' | 'eyes' | 'boo' | 'friendly';

/** One moment of the peekaboo, as the DOM draws it. */
export interface PeekFrame {
  readonly phase: PeekPhase;
  /** The dark over the screen, 0–1. */
  readonly dark: number;
  /** The eyes, 0–1 (how much they show) and their lids (1 open, 0 shut). */
  readonly eyes: number;
  readonly lids: number;
  /** "Peekaboo! 👻": how much it shows, and its size (a pop in, 1 at rest). */
  readonly word: number;
  readonly wordScale: number;
  /** The shake, CSS px. */
  readonly shake: { readonly x: number; readonly y: number };
  /** The friendly echo after, 0–1. */
  readonly friend: number;
}

/** What happens at a moment: the room swaps under the dark, the sting, the giggle, the card. */
export interface PeekBeat {
  readonly at: number;
  readonly kind: 'swap' | 'sting' | 'giggle' | 'card';
}

/** The timeline, ms from the catch. TUNE: all of it. */
const MOTION = {
  darkIn: [0, 220],
  eyesIn: [260, 420],
  blink: [520, 620],
  boo: 720,
  wordIn: 140,
  shake: { ms: 460, px: 13, hz: 19 },
  lift: [1750, 2250],
  friendIn: [1800, 2150],
} as const;
const CALM = {
  darkIn: [0, 600],
  eyesIn: [650, 1000],
  boo: 1050,
  wordIn: 350,
  lift: [2100, 2700],
  friendIn: [2150, 2650],
} as const;

/** The beats in order, ms from the catch (the swap waits for the dark). */
export function peekBeats(calm: boolean): PeekBeat[] {
  const t = calm ? CALM : MOTION;
  return [
    { at: t.darkIn[1], kind: 'swap' },
    { at: t.boo, kind: 'sting' },
    { at: t.friendIn[0] + 100, kind: 'giggle' },
    { at: t.lift[0] + 200, kind: 'card' },
  ];
}

/** The peekaboo at `ms` from the catch. */
export function peekFrame(ms: number, calm: boolean): PeekFrame {
  const t = calm ? CALM : MOTION;
  const lift = ramp(ms, t.lift[0], t.lift[1]);
  const dark = ramp(ms, t.darkIn[0], t.darkIn[1]) * (1 - lift);
  const eyes = ramp(ms, t.eyesIn[0], t.eyesIn[1]) * (1 - lift);
  const word = ramp(ms, t.boo, t.boo + t.wordIn) * (1 - lift);
  const friend = ramp(ms, t.friendIn[0], t.friendIn[1]);
  let lids = 1;
  let wordScale = 1;
  let shake = { x: 0, y: 0 };
  if (!calm) {
    // The eyes blink open (shut at first), and once more before the boo.
    const opening = ramp(ms, MOTION.eyesIn[0], MOTION.eyesIn[1]);
    const [b0, b1] = MOTION.blink;
    const blink = ms > b0 && ms < b1 ? Math.abs((ms - (b0 + b1) / 2) / ((b1 - b0) / 2)) : 1;
    lids = Math.min(opening, blink);
    // "Peekaboo!" pops in a little big and settles.
    const pop = ramp(ms, MOTION.boo, MOTION.boo + MOTION.wordIn);
    wordScale = pop >= 1 ? 1 : 1.25 - 0.25 * pop;
    const s = (ms - MOTION.boo) / MOTION.shake.ms;
    if (s >= 0 && s < 1) {
      const fall = (1 - s) ** 2;
      const w = 2 * Math.PI * MOTION.shake.hz * ((ms - MOTION.boo) / 1000);
      shake = {
        x: Math.round(MOTION.shake.px * fall * Math.sin(w) * 10) / 10,
        y: Math.round(MOTION.shake.px * 0.6 * fall * Math.sin(w * 1.3 + 1) * 10) / 10,
      };
    }
  }
  const phase: PeekPhase =
    ms >= t.friendIn[0] ? 'friendly' : ms >= t.boo ? 'boo' : ms >= t.eyesIn[0] ? 'eyes' : 'dark';
  return { phase, dark, eyes, lids, word, wordScale, shake, friend };
}

function ramp(ms: number, from: number, to: number): number {
  if (ms <= from) return 0;
  if (ms >= to) return 1;
  const x = (ms - from) / (to - from);
  return x * x * (3 - 2 * x);
}

export interface PeekPlay {
  readonly calm: boolean;
  /** The dark is full: move the Keeper back to the light now, unseen. */
  readonly onSwap: () => void;
  /** The friendly card's turn. */
  readonly onCard: () => void;
  readonly cue?: ((name: CueName) => void) | undefined;
}

export interface Peekaboo {
  play: (run: PeekPlay) => void;
  /** The card was read: the friendly echo waves goodbye. */
  done: () => void;
  /** Gone at once (the screen closed). */
  stop: () => void;
  /** Dev only (captures): stops the clock at `ms` from the catch, or lets it run again (`null`). */
  hold: (ms: number | null) => void;
  /** Walking waits while it plays (the card after it waits on its own). */
  readonly active: boolean;
  /** What's playing: its phase, whether it's the calm one, and whether it has shaken yet. */
  readonly debug: { phase: PeekPhase; calm: boolean; shook: boolean; friend: boolean } | null;
}

export function createPeekaboo(root: HTMLElement): Peekaboo {
  const eye = () =>
    el('span', { class: 'crooked-peek-eye' }, el('span', { class: 'crooked-peek-lid' }));
  const eyes = el('div', { class: 'crooked-peek-eyes' }, eye(), eye());
  const word = el('p', { class: 'crooked-peek-word', role: 'alert' });
  const shaker = el('div', { class: 'crooked-peek-shake' }, eyes, word);
  const darkLayer = el('div', { class: 'crooked-peek-dark' });
  const friend = el(
    'div',
    { class: 'crooked-peek-friend', 'data-testid': 'crooked-peek-friend' },
    el(
      'div',
      { class: 'crooked-peek-ghost', 'aria-hidden': 'true' },
      el('span', { class: 'crooked-peek-ghost-eye' }),
      el('span', { class: 'crooked-peek-ghost-eye' }),
      el('span', { class: 'crooked-peek-ghost-cheek' }),
      el('span', { class: 'crooked-peek-ghost-cheek' }),
      el('span', { class: 'crooked-peek-ghost-arm' }),
    ),
    el('p', { class: 'crooked-peek-giggle' }, E.giggle),
  );
  const layer = el(
    'div',
    { class: 'crooked-peek', 'data-testid': 'crooked-peek' },
    darkLayer,
    shaker,
    friend,
  );
  layer.hidden = true;
  root.append(layer);

  let run: PeekPlay | null = null;
  let started = 0;
  let held: number | null = null;
  let beat = 0;
  let raf = 0;
  let last: PeekFrame | null = null;
  let shook = false;

  const clock = () => held ?? performance.now() - started;

  function frame(): void {
    raf = 0;
    const r = run;
    if (!r) return;
    const ms = clock();
    const beats = peekBeats(r.calm);
    // Every beat the clock passed (a held clock jumps several at once).
    for (let b = beats[beat]; b !== undefined && b.at <= ms; b = beats[beat]) {
      beat += 1;
      if (b.kind === 'swap') r.onSwap();
      else if (b.kind === 'sting') r.cue?.('peekaboo');
      else if (b.kind === 'giggle') r.cue?.('giggle');
      else r.onCard();
    }
    draw(peekFrame(ms, r.calm));
    // On to the card's beat; after it, the friendly echo just waits with the card.
    if (beat < beats.length || ms < (beats.at(-1)?.at ?? 0) + 600) {
      raf = requestAnimationFrame(frame);
    }
  }

  function draw(f: PeekFrame): void {
    last = f;
    if (f.shake.x !== 0 || f.shake.y !== 0) shook = true;
    layer.dataset['phase'] = f.phase;
    // The dark takes every touch (Back, Map, Tiptoe…); once friendly, the card's are its own.
    layer.style.pointerEvents = f.phase === 'friendly' ? 'none' : 'auto';
    darkLayer.style.opacity = String(f.dark);
    eyes.style.opacity = String(f.eyes);
    eyes.style.setProperty('--lids', String(f.lids));
    word.style.opacity = String(f.word);
    word.style.transform = `scale(${String(f.wordScale)})`;
    shaker.style.transform =
      f.shake.x === 0 && f.shake.y === 0
        ? ''
        : `translate(${String(f.shake.x)}px, ${String(f.shake.y)}px)`;
    friend.style.opacity = String(f.friend);
    friend.classList.toggle('crooked-peek-friend-on', f.friend > 0);
  }

  function stop(): void {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    run = null;
    last = null;
    layer.hidden = true;
    layer.classList.remove('crooked-peek-calm');
  }

  return {
    play: (next) => {
      stop();
      run = next;
      started = performance.now();
      beat = 0;
      shook = false;
      word.textContent = T.caught;
      layer.classList.toggle('crooked-peek-calm', next.calm);
      layer.hidden = false;
      frame();
    },
    done: stop,
    stop,
    hold: (ms) => {
      if (ms === null && held !== null) started = performance.now() - held;
      held = ms;
      if (run && raf === 0) frame();
    },
    get active() {
      return run !== null && beat < peekBeats(run.calm).length;
    },
    get debug() {
      if (!run) return null;
      return {
        phase: last?.phase ?? 'dark',
        calm: run.calm,
        shook,
        friend: last !== null && last.friend > 0,
      };
    },
  };
}
