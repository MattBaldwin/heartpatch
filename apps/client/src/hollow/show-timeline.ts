import { hexKey, type Hex, type HexKey, type WalkPointView } from '@heartpatch/shared';
import { SHOW } from './hollow-config.js';

// The night show's timeline (#277, owner decisions 2026-10-08): the walk the
// server decided at nightfall becomes a few timed stops. Live, he enters at
// nightfall, backs away from each lit tile spread across the prowl, and
// strikes the dark spots when it ends (7:30 PM); the morning replay plays the
// same stops a few seconds apart. Pure, so the timing and the narrator's
// words are unit-tested; the Hollow Man never speaks (style guide §5).

export type BeatKind = WalkPointView['kind'];

/** One stop of the show: where he goes, what he does there, and when (ms from the show's start). */
export interface Beat {
  readonly kind: BeatKind;
  readonly q: number;
  readonly r: number;
  readonly at: number;
}

/**
 * The show's stops for a walk: his backing away from lit tiles first, then
 * the strikes (they come at the prowl's end), each in the walk's own order
 * round the Heart Seed. He enters at the first stop and leaves from the last.
 * `prowlMs` is the live prowl; `null` plays the morning replay, sped up.
 * Empty when the walk has nowhere to go.
 */
export function showBeats(walk: readonly WalkPointView[], prowlMs: number | null): Beat[] {
  const recoils = walk.filter((p) => p.kind === 'recoil');
  const strikes = walk.filter((p) => p.kind === 'strike');
  const stops = [...recoils, ...strikes];
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return [];
  const beats: Beat[] = [{ kind: 'enter', q: first.q, r: first.r, at: 0 }];
  if (prowlMs === null) {
    stops.forEach((p, i) =>
      beats.push({ kind: p.kind, q: p.q, r: p.r, at: (i + 1) * SHOW.replayBeatMs }),
    );
    beats.push({ kind: 'leave', q: last.q, r: last.r, at: (stops.length + 1) * SHOW.replayBeatMs });
    return beats;
  }
  recoils.forEach((p, i) =>
    beats.push({ kind: 'recoil', q: p.q, r: p.r, at: (prowlMs * (i + 1)) / (recoils.length + 1) }),
  );
  strikes.forEach((p, i) =>
    beats.push({ kind: 'strike', q: p.q, r: p.r, at: prowlMs + i * SHOW.strikeGapMs }),
  );
  const end = strikes.length > 0 ? prowlMs + strikes.length * SHOW.strikeGapMs : prowlMs;
  beats.push({ kind: 'leave', q: last.q, r: last.r, at: end });
  return beats;
}

/** The last stop that has come by `elapsed` ms into the show (-1: none yet). */
export function beatIndexAt(beats: readonly Beat[], elapsed: number): number {
  let index = -1;
  for (const [i, beat] of beats.entries()) if (beat.at <= elapsed) index = i;
  return index;
}

/** The narrator's words for the show (style guide §1, §5, §9): calm, short, and never his. */
export const SHOW_TEXT = {
  narrator: 'Narrator',
  skip: 'Skip',
  enter: 'Night has come. The Hollow Man is out walking… Stay close to the firelight!',
  recoil: (place: string) => `The fire's too bright! He backs away from ${place}.`,
  /** Home is lit by the Heart Seed, not a fire (owner decision 2026-10-07). */
  recoilHome: 'Your Heart Seed glows too bright! He backs away from home.',
  /** A strike on dark land he won back. */
  wild: (place: string) => `He found a dark spot. ${place} went wild again.`,
  /** A strike where nothing went wild (he only found a squishy there). */
  found: 'He found a dark spot…',
  taken: (names: readonly string[]) =>
    `${joinNames(names)} ${names.length > 1 ? 'were' : 'was'} taken to the Hollow. You can rescue them!`,
  /** He leaves after a night with no strike. */
  safe: 'Your fires kept him out. Nice planning!',
  leave: 'He fades away. Morning will come soon.',
} as const;

/** "Pip", "Pip and Mo", "Pip, Mo and Bo". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** What the narrator knows about my night (only my own walk is narrated). */
export interface Narration {
  /** A tile's name for the narrator, e.g. "your meadow". */
  placeOf: (h: Hex) => string;
  /** The tile is home (the Heart Seed keeps it lit, not a fire). */
  isHome: (h: Hex) => boolean;
  /** My land he won back. */
  reclaimed: ReadonlySet<HexKey>;
  /** Who of mine he took, by name. */
  taken: readonly string[];
  /** The show has a strike (else he leaves kept out). */
  strikes: number;
}

/**
 * The narrator's line for a stop of my walk. Who he took is told on the last
 * strike, so the kid hears it once, with "you can rescue them!".
 */
export function narrate(beats: readonly Beat[], index: number, story: Narration): string {
  const beat = beats[index];
  if (!beat) return '';
  switch (beat.kind) {
    case 'enter':
      return SHOW_TEXT.enter;
    case 'recoil':
      return story.isHome(beat) ? SHOW_TEXT.recoilHome : SHOW_TEXT.recoil(story.placeOf(beat));
    case 'strike': {
      const here = story.reclaimed.has(hexKey(beat))
        ? SHOW_TEXT.wild(capitalise(story.placeOf(beat)))
        : SHOW_TEXT.found;
      const lastStrike = !beats.slice(index + 1).some((b) => b.kind === 'strike');
      return lastStrike && story.taken.length > 0
        ? `${here} ${SHOW_TEXT.taken(story.taken)}`
        : here;
    }
    case 'leave':
      return story.strikes > 0 ? SHOW_TEXT.leave : SHOW_TEXT.safe;
  }
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
