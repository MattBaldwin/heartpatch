import { hexKey, type Hex, type HexKey, type WalkPointView } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { SHOW } from './hollow-config.js';
import {
  beatIndexAt,
  narrate,
  showBeats,
  SHOW_TEXT,
  type Beat,
  type BeatKind,
  type Narration,
} from './show-timeline.js';

// The night show (#277, mockup screens 2–5): plays the Hollow Man's walks
// from the night's outcome, which the server decided at nightfall (rule 1;
// nothing is simulated here). Live, it runs from nightfall to the strike
// (a kid opening the app part way joins it part way); the morning replay
// plays one walk sped up. Land he won back is drawn as its Keeper's until
// his strike lands there. Only my own walk is narrated, by the narrator
// (style guide §5: he never speaks); others' walks play silently on the map
// (owner decision 2026-10-08 Q7: never which squishy was taken). Between
// stops nothing moves, so the map draws nothing.

/** One Keeper's walk to play. */
export interface ShowWalk {
  readonly userId: string;
  readonly walk: readonly WalkPointView[];
  /** Their land he won back: drawn as theirs until he strikes there. */
  readonly reclaimed: readonly Hex[];
  /** Their Heart Seed, so he stands on the far side of their border. */
  readonly seed: Hex | null;
  /** My walk's story, read at each stop (null: not mine, not narrated). */
  readonly story: (() => Narration) | null;
}

/** What the show moves on the map (the Hollow layer and the map screen). */
export interface ShowStage {
  walk: (
    keeper: string,
    beat: Pick<Beat, 'kind' | 'q' | 'r'>,
    seed: Hex | null,
    still: boolean,
    done?: () => void,
  ) => boolean;
  endWalks: () => void;
  /** Land drawn as its Keeper's for now (tile → user id). */
  hold: (held: ReadonlyMap<HexKey, string>) => void;
  /** A stop of my walk plays: a sound for it (a hush, a chime, a cold wind). */
  cue?: (kind: BeatKind) => void;
  /** Glides the camera to a stop of my walk. */
  pan?: (h: Hex) => void;
}

/** The narrator's card: a line (and who he took, greyed) or nothing. */
export interface ShowCaption {
  say: (line: string, withTokens: boolean) => void;
  hide: () => void;
  readonly shown: boolean;
}

/** The narrator's card on screen, with Skip (style guide §5: the narrator, never him). */
export function domCaption(
  root: HTMLElement,
  onSkip: () => void,
  tokens: () => HTMLElement[],
): ShowCaption {
  const who = el('span', { class: 'night-caption-who' }, SHOW_TEXT.narrator);
  const text = el('span', { class: 'night-caption-line', 'data-testid': 'night-caption-line' });
  const pics = el('span', { class: 'night-caption-tokens' });
  const skip = el(
    'button',
    { type: 'button', class: 'night-caption-skip', 'data-testid': 'night-show-skip' },
    SHOW_TEXT.skip,
  );
  skip.addEventListener('click', onSkip);
  const card = el(
    'div',
    { class: 'night-caption', role: 'status', 'data-testid': 'night-caption' },
    el('p', { class: 'night-caption-text' }, who, text, pics),
    skip,
  );
  card.hidden = true;
  root.append(card);
  return {
    say: (line, withTokens) => {
      text.textContent = line;
      pics.replaceChildren(...(withTokens ? tokens() : []));
      card.hidden = false;
    },
    hide: () => {
      card.hidden = true;
      text.textContent = '';
      pics.replaceChildren();
    },
    get shown() {
      return !card.hidden;
    },
  };
}

export interface NightShowDebug {
  readonly playing: boolean;
  readonly mode: 'live' | 'replay' | null;
  /** The narrator's line on screen ('' when none). */
  readonly line: string;
  /** My walk's stop now (-1: none yet). */
  readonly beat: number;
  /** My walk's stops. */
  readonly beats: number;
  /** Tiles drawn as their Keeper's until he strikes there. */
  readonly held: number;
}

export interface NightShow {
  /**
   * Plays these walks from `startedAt` (wall-clock ms): live with `prowlMs`
   * (the strike lands then), or the replay (`prowlMs` null) from now. A show
   * already playing ends first. `onEnd` is called when it's over, skipped
   * (true) or not (false). False if there's nothing to play.
   */
  play: (
    walks: readonly ShowWalk[],
    startedAt: number,
    prowlMs: number | null,
    onEnd: (skipped: boolean) => void,
  ) => boolean;
  /** Ends the show now, as Skip does (the land shows as it is). */
  skip: () => void;
  /** Ends the show without calling `onEnd` (the map closed). */
  stop: () => void;
  readonly playing: boolean;
  readonly debug: NightShowDebug;
}

export function createNightShow(options: {
  stage: ShowStage;
  /** Makes the narrator's card, given what Skip does. */
  caption: (onSkip: () => void) => ShowCaption;
  /** Wall-clock ms (tests pass a fake). */
  now?: () => number;
  /** Timers (tests pass fakes). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): NightShow {
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number): unknown => {
      return setTimeout(fn, ms);
    });
  const clearTimer =
    options.clearTimer ??
    ((h) => {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    });
  const { stage } = options;

  let timers: unknown[] = [];
  let mode: 'live' | 'replay' | null = null;
  let held = new Map<HexKey, string>();
  let ending: ((skipped: boolean) => void) | null = null;
  let myBeats: Beat[] = [];
  let myBeat = -1;
  let line = '';
  /** Walks still to reach their `leave`. */
  let walking = 0;

  const caption = options.caption(() => {
    finish(true);
  });

  const say = (next: string, withTokens: boolean) => {
    line = next;
    if (next === '') caption.hide();
    else caption.say(next, withTokens);
  };

  const release = (keeper: string, tiles: readonly HexKey[]) => {
    let changed = false;
    for (const key of tiles) {
      if (held.get(key) !== keeper) continue;
      held.delete(key);
      changed = true;
    }
    if (changed) stage.hold(held);
  };

  const clearAll = () => {
    for (const t of timers) clearTimer(t);
    timers = [];
    stage.endWalks();
    if (held.size > 0) {
      held = new Map();
      stage.hold(held);
    }
    mode = null;
    myBeats = [];
    myBeat = -1;
    walking = 0;
    say('', false);
  };

  function finish(skipped: boolean): void {
    if (mode === null) return;
    const done = ending;
    ending = null;
    clearAll();
    done?.(skipped);
  }

  return {
    play: (walks, startedAt, prowlMs, onEnd) => {
      if (mode !== null) {
        const done = ending;
        ending = null;
        clearAll();
        done?.(false);
      }
      const plans = walks
        .map((w) => ({ w, beats: showBeats(w.walk, prowlMs) }))
        .filter((p) => p.beats.length > 0);
      if (plans.length === 0) return false;
      mode = prowlMs === null ? 'replay' : 'live';
      ending = onEnd;
      const elapsed = Math.max(0, now() - startedAt);
      const fresh = elapsed < 10_000;
      held = new Map();
      walking = plans.length;
      for (const { w, beats } of plans) {
        const mine = w.story !== null;
        if (mine) myBeats = beats;
        const struck = new Set(beats.filter((b) => b.kind === 'strike').map((b) => hexKey(b)));
        const past = beatIndexAt(beats, elapsed);
        // Land he won back stays its Keeper's until his strike there has come.
        for (const h of w.reclaimed) {
          const key = hexKey(h);
          const strikeDone = beats.some(
            (b, i) => i <= past && b.kind === 'strike' && hexKey(b) === key,
          );
          if (!strikeDone && struck.has(key)) held.set(key, w.userId);
        }
        const run = (i: number, still: boolean) => {
          const beat = beats[i];
          if (!beat || mode === null) return;
          const tell = w.story;
          if (tell) {
            myBeat = i;
            const story = tell();
            // Who he took is told (with their greyed tokens) on the last strike.
            const lastStrike =
              beat.kind === 'strike' && !beats.slice(i + 1).some((b) => b.kind === 'strike');
            say(narrate(beats, i, story), lastStrike && story.taken.length > 0);
            if (!still) stage.cue?.(beat.kind);
            if (!still && (mode === 'replay' || (beat.kind === 'enter' && fresh)))
              stage.pan?.(beat);
          }
          stage.walk(w.userId, beat, w.seed, still, () => {
            if (beat.kind === 'strike') release(w.userId, [hexKey(beat)]);
          });
          if (still && beat.kind === 'strike') release(w.userId, [hexKey(beat)]);
          if (beat.kind === 'leave') {
            walking -= 1;
            // The last walk has left: the show is over once its words have been read.
            if (walking === 0) {
              const read = mine || mode === 'replay' ? 3_000 : 0;
              timers.push(
                setTimer(() => {
                  finish(false);
                }, read),
              );
            }
          }
        };
        // Joining part way: he stands where his last stop ended (a stop
        // only just begun still plays).
        const since = past >= 0 ? elapsed - (beats[past]?.at ?? 0) : 0;
        const first = past >= 0 && since >= SHOW.moveMs ? past + 1 : Math.max(0, past);
        if (first > 0) run(first - 1, true);
        for (let i = first; i < beats.length; i++) {
          const beat = beats[i];
          if (!beat) continue;
          timers.push(
            setTimer(
              () => {
                run(i, false);
              },
              Math.max(0, beat.at - elapsed),
            ),
          );
        }
      }
      if (held.size > 0) stage.hold(held);
      return true;
    },
    skip: () => {
      finish(true);
    },
    stop: () => {
      ending = null;
      clearAll();
    },
    get playing() {
      return mode !== null;
    },
    get debug() {
      return {
        playing: mode !== null,
        mode,
        line,
        beat: myBeat,
        beats: myBeats.length,
        held: held.size,
      };
    },
  };
}
