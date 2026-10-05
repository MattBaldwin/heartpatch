import type { PlaybackStep } from '../battle/battle-playback.js';
import type { CloseUpTouch } from '../close-up/close-up-view.js';

// Which sound goes with which moment (#25). Screens report what happened
// (a battle step, a touch, a care squish); this maps it to a cue, so the
// screens never know about sound. Style guide §7: soft, round and bouncy;
// spooky is a low hush, never a sting.

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
  /** The Hollow Man comes by: a quiet low hush while the music dips. */
  | 'nightfall'
  /** The opening cinematic (#46): a squishy blooms out of the ground. */
  | 'bloom'
  /** The Heartpatch breaks into Heart Seeds: a soft glassy sparkle, never a crash. */
  | 'shatter'
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
  'nightfall',
  'bloom',
  'shatter',
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
  'charm',
  'evolve',
  'yay',
  'title',
]);

/** UI cues go on the UI bus; the rest on the SFX bus (both follow the Sounds slider). */
export const UI_CUES: ReadonlySet<CueName> = new Set(['tick']);

/** A battle step as it plays (`battle-screen`'s playback). */
export function battleCue(
  step: Pick<PlaybackStep, 'kind' | 'squish'> & Partial<Pick<PlaybackStep, 'effectiveness'>>,
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
      return 'twinkle';
    case 'tuckered':
      return 'sleepy';
    case 'swap':
      return 'pop';
    case 'capture':
      // The playback bounces a new friend and wobbles one that wiggled free.
      return step.squish === 'bounce' ? 'charm' : 'wiggle-free';
    case 'end':
      // Only my win bounces; a tie, a scoot or a loss is a soft "aww".
      return step.squish === 'bounce' ? 'yay' : 'aww';
    case 'effect':
      return 'boop';
  }
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
