import type { PlaybackStep } from '../battle/battle-playback.js';
import type { CloseUpTouch } from '../close-up/close-up-view.js';

// Which sound goes with which moment (#25). Screens report what happened
// (a battle step, a touch, a care squish); this maps it to a cue, so the
// screens never know about sound. Style guide §7: soft, round and bouncy;
// spooky is a low hush. The one exception is the opening cinematic's low
// rumbling sting as the Hollow Man reaches (owner decision 2026-10-04).

export type CueName =
  /** UI: any button. */
  | 'tick'
  /** Squishies, up close and at home. */
  | 'boop'
  | 'squeak'
  | 'giggle'
  | 'nom'
  /** Care done, and an evolution. */
  | 'twinkle'
  | 'evolve'
  /** Battles. */
  | 'whoosh'
  | 'bonk'
  /** A super or good hit lands (owner decision 2026-10-04: action-cartoon battles). */
  | 'thwack'
  | 'whiff'
  | 'sleepy'
  | 'pop'
  | 'charm'
  | 'wiggle-free'
  | 'yay'
  | 'aww'
  /**
   * A rare-or-better wild squishy shows up (#391): a bell glimmer over a
   * rising sweep, one more note at each size step of its tier (Rare is 1).
   */
  | 'find-1'
  | 'find-2'
  | 'find-3'
  | 'find-4'
  /** A rare-or-better new friend (#391): a harp run up into a bell chord, in place of 'yay'. */
  | 'friend-fanfare'
  /** The Hollow Man comes by: a quiet low hush while the music dips. */
  | 'nightfall'
  /** The opening cinematic (#46): a squishy blooms out of the ground. */
  | 'bloom'
  /**
   * The Hollow Man reaches for the Heartpatch, eyes flaring: a low rumbling
   * sting (owner decision 2026-10-04, "spooky-tense"). Never a scream or a crash.
   */
  | 'hollow-sting'
  /** The Heartpatch breaks into Heart Seeds: a soft glassy sparkle, never a crash. */
  | 'shatter'
  /** The cold wind that blows the joy and the squishies away across the land. */
  | 'cold-wind'
  /** A Heart Seed lands at the Keeper's feet. */
  | 'seed-land'
  /** The title card. */
  | 'title';

export const CUE_NAMES: readonly CueName[] = [
  'tick',
  'boop',
  'squeak',
  'giggle',
  'nom',
  'twinkle',
  'evolve',
  'whoosh',
  'bonk',
  'thwack',
  'whiff',
  'sleepy',
  'pop',
  'charm',
  'wiggle-free',
  'yay',
  'aww',
  'find-1',
  'find-2',
  'find-3',
  'find-4',
  'friend-fanfare',
  'nightfall',
  'bloom',
  'hollow-sting',
  'shatter',
  'cold-wind',
  'seed-land',
  'title',
];

/** True for a cue the engine has a sound for (data names cues as plain strings). */
export function isCueName(name: string): name is CueName {
  return (CUE_NAMES as readonly string[]).includes(name);
}

/** Cues that dip the music while they play (tech spec §15 "Mix"). */
export const DUCKING_CUES: ReadonlySet<CueName> = new Set([
  'nightfall',
  'hollow-sting',
  'charm',
  'evolve',
  'yay',
  'find-1',
  'find-2',
  'find-3',
  'find-4',
  'friend-fanfare',
  'title',
]);

/** UI cues go on the UI bus; the rest on the SFX bus (both follow the Sounds slider). */
export const UI_CUES: ReadonlySet<CueName> = new Set(['tick']);

/** A battle step as it plays (`battle-screen`'s playback). */
export function battleCue(
  step: Pick<PlaybackStep, 'kind' | 'squish'> & Partial<Pick<PlaybackStep, 'effectiveness'>>,
  rareFriend = false,
): CueName | null {
  switch (step.kind) {
    case 'move':
      return 'whoosh';
    case 'hit':
      // A big one thwacks; an ordinary or weak one is the soft bonk.
      return step.effectiveness === 'super' || step.effectiveness === 'good' ? 'thwack' : 'bonk';
    case 'miss':
    case 'forfeit':
      return 'whiff';
    case 'heal':
    case 'item':
      return 'twinkle';
    case 'tuckered':
      return 'sleepy';
    case 'swap':
      return 'pop';
    case 'capture':
      // The playback bounces a new friend and wobbles one that wiggled free.
      return step.squish === 'bounce' ? 'charm' : 'wiggle-free';
    case 'end':
      // Only my win bounces; a tie, a scoot or a loss is a soft "aww". A rare
      // new friend's win is a fanfare (#391).
      if (step.squish !== 'bounce') return 'aww';
      return rareFriend ? 'friend-fanfare' : 'yay';
    case 'effect':
      return 'boop';
  }
}

/** A rare-or-better wild squishy shows up (#391): its tier's size step, 1–4 (bigger ones share 4's). */
export function findCue(scale: number): CueName {
  const step = Math.min(Math.max(Math.round(scale), 1), 4);
  return step === 1 ? 'find-1' : step === 2 ? 'find-2' : step === 3 ? 'find-3' : 'find-4';
}

/** A touch on a squishy up close (#20). */
export function touchCue(kind: CloseUpTouch): CueName {
  switch (kind) {
    case 'boop':
      return 'boop';
    case 'stroke':
      return 'squeak';
    case 'tickle':
      return 'giggle';
    case 'treat':
      return 'nom';
  }
}

/** The care sheet's squash after care, or its sparkles after an evolution (#19). */
export function careCue(kind: 'care' | 'evolve'): CueName {
  return kind === 'evolve' ? 'evolve' : 'twinkle';
}
