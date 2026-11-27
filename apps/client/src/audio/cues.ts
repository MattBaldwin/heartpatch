import { ElementIdSchema, type ElementId } from '@heartpatch/shared';
import type { PlaybackStep } from '../battle/battle-playback.js';
import type { BossBeat } from '../battle/boss-beat.js';
import type { CloseUpTouch } from '../close-up/close-up-view.js';

// Which sound goes with which moment (#25). Screens report what happened
// (a battle step, a touch, a care squish); this maps it to a cue, so the
// screens never know about sound. Style guide §7: soft, round and bouncy;
// spooky is a low hush. The one exception is the opening cinematic's low
// rumbling sting as the Hollow Man reaches (owner decision 2026-10-04), and
// the Crooked House's peekaboo has a short sting of its own (#306 6d).

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
  /**
   * The Crooked House's peekaboo (#306 6d, owner decision 3: spookier, a
   * deliberate exception to "no jump scares"): a sudden low "boo" under two
   * uneasy bell notes, over in about a second. Never a scream.
   */
  | 'peekaboo'
  /** The Heartpatch breaks into Heart Seeds: a soft glassy sparkle, never a crash. */
  | 'shatter'
  /** The cold wind that blows the joy and the squishies away across the land. */
  | 'cold-wind'
  /** A Heart Seed lands at the Keeper's feet. */
  | 'seed-land'
  /** The title card. */
  | 'title'
  /**
   * Big moments in the Crooked House (#653): a chest opens (a crescendo:
   * build, swell, sparkle; the bonus room's quick, the attic's big one slower,
   * each landing on its lid), a power door wakes, a key turns up, a room is
   * put right. Recorded CC0 hits layered with the synth (`recorded.ts`).
   */
  | 'chest'
  | 'chest-big'
  | 'door-wake'
  | 'key-found'
  | 'room-bloom'
  /** Christmas (#37): a soft shake of sleigh bells. */
  | 'sleigh-bells'
  /** Christmas (#37): a boot crunching in fresh snow. */
  | 'snow-crunch'
  /**
   * A BIG squishy's beats (#190 PR 4, owner answer 4): its own silly squishy
   * voice, low and big, with its move's element stinger under it. The windup
   * is a slow "hmmm… HUP!"; the landing a "bwomp!" on a soft thud.
   */
  | BossVoiceCue
  /** The boss's friend comes in to help: a two-note "yoo-hoo!". */
  | 'boss-backup'
  /** The boss is tuckered out: a big sleepy "phewww", then a little cheer. */
  | 'boss-tuckered';

/** A boss voice cue: its beat and the element of the move under it. */
export type BossVoiceCue = `boss-${'windup' | 'landing'}-${ElementId}`;

/** The elements the boss stingers are keyed by (never by boss name), as the battle's element FX are. */
export const BOSS_ELEMENTS: readonly ElementId[] = ElementIdSchema.options;

/**
 * A move with no element gets this one's stinger, matching the arena's
 * fallback (`FALLBACK_ELEMENT` in `element-fx.ts`, checked by a test).
 */
export const BOSS_FALLBACK_ELEMENT: ElementId = 'light';

const BOSS_VOICE_CUES: readonly BossVoiceCue[] = (['windup', 'landing'] as const).flatMap((beat) =>
  BOSS_ELEMENTS.map((element): BossVoiceCue => `boss-${beat}-${element}`),
);

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
  'peekaboo',
  'shatter',
  'cold-wind',
  'seed-land',
  'title',
  'chest',
  'chest-big',
  'door-wake',
  'key-found',
  'room-bloom',
  'sleigh-bells',
  'snow-crunch',
  ...BOSS_VOICE_CUES,
  'boss-backup',
  'boss-tuckered',
];

/** True for a cue the engine has a sound for (data names cues as plain strings). */
export function isCueName(name: string): name is CueName {
  return (CUE_NAMES as readonly string[]).includes(name);
}

/** Cues that dip the music while they play (tech spec §15 "Mix"). */
export const DUCKING_CUES: ReadonlySet<CueName> = new Set([
  'nightfall',
  'hollow-sting',
  'peekaboo',
  'charm',
  'evolve',
  'yay',
  'find-1',
  'find-2',
  'find-3',
  'find-4',
  'friend-fanfare',
  'title',
  'chest',
  'chest-big',
  'door-wake',
  'key-found',
  'room-bloom',
  // A boss's windup, landing and tuckering out (#190 PR 4): the stinger ducks like 'hollow-sting'.
  ...BOSS_VOICE_CUES,
  'boss-tuckered',
]);

/** UI cues go on the UI bus; the rest on the SFX bus (both follow the Sounds slider). */
export const UI_CUES: ReadonlySet<CueName> = new Set(['tick']);

/**
 * A battle step as it plays (`battle-screen`'s playback). `beat`: the boss's
 * beat in a boss fight (#190 PR 4), which plays the boss's cue in place of
 * the step's own (one boss cue per step).
 */
export function battleCue(
  step: Pick<PlaybackStep, 'kind' | 'squish'> & Partial<Pick<PlaybackStep, 'effectiveness'>>,
  rareFriend = false,
  beat: BossBeat | null = null,
): CueName | null {
  if (beat) {
    const element = beat.element ?? BOSS_FALLBACK_ELEMENT;
    switch (beat.kind) {
      case 'windup':
        return `boss-windup-${element}`;
      case 'landing':
        return `boss-landing-${element}`;
      case 'backup':
        return 'boss-backup';
      case 'end':
        // The boss tuckered out (my win); anything else is the same kind "aww".
        return step.squish === 'bounce' ? 'boss-tuckered' : 'aww';
    }
  }
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
