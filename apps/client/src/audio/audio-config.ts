import type { ElementId } from '@heartpatch/shared';
import type { InstrumentId } from './music-samples.js';
import type { Voice } from './music-score.js';

// Tunable numbers for sound and music (#25, tech spec §15). Most sound is
// synthesised in the browser (Web Audio); the big moments layer a few CC0
// recorded hits (#653) and the music plays CC0 instrument notes (#664,
// ASSETS.md).

/** Bus levels at full slider, before the player's own volume. Quiet by default. */
export const MIX = {
  music: 0.22, // TUNE: music sits well under the squeaks
  sfx: 0.55, // TUNE
  ui: 0.3, // TUNE: button ticks are a whisper
  /** The limiter on the master bus (a hard-knee compressor). */
  limiterThresholdDb: -8, // TUNE
  /** A light room reverb (#653): its length, and how much SFX and UI send into it. */
  reverbS: 1.4, // TUNE
  sfxReverb: 0.22, // TUNE: cozy, not a cathedral
  uiReverb: 0.08, // TUNE: button ticks stay dry and close
  /** The music's soft room (#664), rendered into each loop: a little more than the SFX, so the instruments bloom. */
  musicReverb: 0.3, // TUNE
} as const;

/** What a new device starts with (sliders are 0–1). */
export const DEFAULT_VOLUMES = {
  music: 0.6, // TUNE
  sounds: 0.8, // TUNE
} as const;

export const MUSIC = {
  /** Cross-fade between the day, night and season loops. */
  crossFadeS: 2.5, // TUNE
  /** Music dips under key moments (his visit, a new friend). */
  duckTo: 0.25, // TUNE: fraction of the music level
  duckFadeS: 0.4, // TUNE
  /** Loops are rendered once, mono, at this rate (memory: ~90 KB per second). */
  sampleRate: 22_050,
  /** Room after the last beat for notes to ring out; folded back into the loop start. */
  tailS: 3,
  /**
   * Every loop is levelled to this loudness (RMS), then pulled down if a peak
   * would pass `peak`, so day, night, Halloween and Christmas sit at one level (#664).
   */
  rms: 0.13, // TUNE: today's synth loops measure 0.10-0.17
  peak: 0.85, // TUNE
  /**
   * How long a loop waits for the instrument notes before it renders with
   * the synth instead (#664); it's re-rendered with them once they're in.
   */
  instrumentWaitS: 5, // TUNE
} as const;

/**
 * How each score voice plays its instrument (#664): its level, how it starts
 * and ends, and how long it rings past the note. Sustained voices (strings,
 * flute) fade at the note's end; struck ones ring on, like the real thing.
 */
export interface VoiceStyle {
  readonly instrument: InstrumentId;
  readonly gain: number;
  /** Fade-in, seconds (0: the sample's own attack). */
  readonly attack: number;
  /** Rings this long past the note's end before its release (Infinity: to its end). */
  readonly ring: number;
  readonly release: number;
  /** Rounds the top off (Hz); none if 0. Cozy means no glassy highs. */
  readonly lowpass: number;
}

export const VOICE_STYLES: Readonly<Record<Voice, VoiceStyle>> = {
  pad: { instrument: 'strings', gain: 0.5, attack: 0.5, ring: 0, release: 0.9, lowpass: 2600 }, // TUNE
  bass: { instrument: 'bass', gain: 0.65, attack: 0, ring: 0.5, release: 0.3, lowpass: 1200 }, // TUNE
  pluck: { instrument: 'marimba', gain: 0.75, attack: 0, ring: 0.6, release: 0.3, lowpass: 3800 }, // TUNE
  bell: { instrument: 'glock', gain: 2.1, attack: 0, ring: Infinity, release: 0, lowpass: 5200 }, // TUNE
  whistle: { instrument: 'flute', gain: 1, attack: 0.08, ring: 0, release: 0.35, lowpass: 4200 }, // TUNE
  piano: { instrument: 'piano', gain: 1.4, attack: 0, ring: 0.6, release: 0.5, lowpass: 3600 }, // TUNE
  harp: { instrument: 'harp', gain: 1.3, attack: 0, ring: Infinity, release: 0, lowpass: 4200 }, // TUNE
  pizz: { instrument: 'pizz', gain: 0.95, attack: 0, ring: Infinity, release: 0, lowpass: 4000 }, // TUNE
  shaker: {
    instrument: 'shaker',
    gain: 2,
    attack: 0,
    ring: Infinity,
    release: 0,
    lowpass: 6000,
  }, // TUNE
};

export const SFX = {
  /** Most voices sounding at once; extra cues are dropped (a tap storm stays polite). */
  maxVoices: 10, // TUNE
  /** The same cue again sooner than this is dropped. */
  minRepeatS: 0.05, // TUNE
  /** Random pitch spread per play (± fraction), so repeats don't sound copied. */
  pitchJitter: 0.06, // TUNE
  /** The big moments' tunes vary less, so they stay in tune with the music. */
  recordedPitchJitter: 0.015, // TUNE
  /** Random volume spread per play (fraction off the top). */
  gainJitter: 0.15, // TUNE
} as const;

/**
 * The winter sounds (#37). Sleigh bells are a few quick shakes of tiny
 * jingles; snow crunch is a handful of packed-snow grains under a soft step.
 */
export const WINTER_SFX = {
  /** When each shake of the sleigh bells lands, seconds from the start. */
  shakesS: [0, 0.11, 0.22, 0.4], // TUNE
  /** The little bells in one shake, Hz (inharmonic, so it jingles rather than chimes). */
  jingleHz: [2650, 3170, 3720, 4410], // TUNE
  /** How long each jingle rings, seconds. */
  jingleRingS: 0.22, // TUNE
  /** The jingles' level, and the metal hiss under each shake. */
  jingleGain: 0.11, // TUNE
  hissGain: 0.12, // TUNE
  /** Snow crunch: how many grains, how far apart (seconds), and their level. */
  crunchGrains: 4, // TUNE
  crunchGapS: 0.028, // TUNE
  crunchGain: 0.5, // TUNE
  /** The soft step under the crunch, Hz, and its level. */
  stepHz: 150, // TUNE
  stepGain: 0.35, // TUNE
} as const;

/** One element's stinger under the boss's voice (#190 PR 4): a short motif, and a noise bed. */
export interface BossStinger {
  readonly wave: OscillatorType;
  readonly rootHz: number;
  /** The motif's notes, semitones above the root. */
  readonly steps: readonly number[];
  /** Seconds between notes, and how long each rings. */
  readonly stepS: number;
  readonly noteS: number;
  /** Each note glides to this many times its pitch (1: holds). */
  readonly glide: number;
  /** Fade-in, seconds: a slow one swells like brass. */
  readonly attack: number;
  /** Rounds the top off, Hz (cozy: no glassy highs). */
  readonly lowpass: number;
  /** A noise bed under the motif (a rustle, a rumble, a hush), or none. */
  readonly bed: {
    readonly filter: BiquadFilterType;
    readonly freq: number;
    readonly to: number;
    readonly q: number;
    readonly gain: number;
    readonly dur: number;
  } | null;
}

/**
 * The BIG squishies' sounds (#190 PR 4, owner answer 4): the boss's own
 * silly squishy voice, low and big, with the element stinger under it.
 * Never a growl, a scream or a crash. Every boss cue peaks no higher than
 * `yay` (cues.test.ts), under the master limiter.
 */
export const BOSS_SFX = {
  /** The boss's voice: a low sine with a soft vowel over it and a sub under it, Hz. */
  voiceHz: 130, // TUNE: low and big, but still a squishy, not a growl
  voiceGain: 0.4, // TUNE
  /** The voice's wobble: rate (Hz) and depth (fraction), so it sounds silly. */
  vibrato: [5.5, 0.035] as const, // TUNE
  /** The windup's slow "hmmm…" rising, seconds, then a quick "HUP!". */
  windupS: 0.7, // TUNE: the windup step is about a second long
  hupS: 0.14, // TUNE
  /** The landing's "bwomp!", seconds. */
  landingS: 0.34, // TUNE
  /** The soft thud under the landing: a falling low sine and a puff, Hz and level. */
  thudHz: 75, // TUNE
  thudGain: 0.32, // TUNE: rendered boss cues peak at most ~0.57 against yay 0.59 (/sounds.html check())
  puffGain: 0.28, // TUNE
  /** The stinger's level under the voice, and how far behind the voice it starts. */
  stingerGain: 0.15, // TUNE
  stingerDelayS: 0.04, // TUNE
  /** Backup's "yoo-hoo!": the two notes, Hz. */
  backupHz: [262, 196] as const, // TUNE
  /** Tuckered out: the "phewww" from and to, Hz, and how long it sighs. */
  tuckeredHz: [220, 104] as const, // TUNE
  tuckeredS: 0.9, // TUNE
  /** The little cheer after the sigh: its level against `yay`'s chime. */
  cheerGain: 0.26, // TUNE: softer than yay (0.32)
  /** Android's buzz on the landing thump (owner answer 5), ms: on, off, on… */
  vibrateMs: [30] as readonly number[], // TUNE
  /** Each element's stinger, keyed like the arena's element FX. */
  stingers: {
    // A brass-like swell.
    fire: {
      wave: 'sawtooth',
      rootHz: 196,
      steps: [0, 4, 7],
      stepS: 0.09,
      noteS: 0.5,
      glide: 1,
      attack: 0.06,
      lowpass: 1100,
      bed: null,
    },
    // Bubbles blooping up.
    water: {
      wave: 'sine',
      rootHz: 392,
      steps: [0, 5, 9, 12],
      stepS: 0.07,
      noteS: 0.16,
      glide: 1.3,
      attack: 0.005,
      lowpass: 2400,
      bed: null,
    },
    // A rustle and a rake scrape.
    leaf: {
      wave: 'triangle',
      rootHz: 330,
      steps: [0, 2, 7],
      stepS: 0.1,
      noteS: 0.3,
      glide: 1,
      attack: 0.01,
      lowpass: 2200,
      bed: { filter: 'bandpass', freq: 3200, to: 1800, q: 0.8, gain: 0.5, dur: 0.4 },
    },
    // A low rumble and a chilly minor chord.
    frost: {
      wave: 'triangle',
      rootHz: 165,
      steps: [0, 3, 7, 10],
      stepS: 0.12,
      noteS: 0.45,
      glide: 1,
      attack: 0.02,
      lowpass: 1400,
      bed: { filter: 'lowpass', freq: 260, to: 140, q: 0.7, gain: 0.9, dur: 0.6 },
    },
    // An engine rev.
    spark: {
      wave: 'square',
      rootHz: 110,
      steps: [0, 7, 12],
      stepS: 0.08,
      noteS: 0.2,
      glide: 1.5,
      attack: 0.008,
      lowpass: 1200,
      bed: null,
    },
    // Wooden knocks.
    stone: {
      wave: 'triangle',
      rootHz: 147,
      steps: [0, 0, -5],
      stepS: 0.14,
      noteS: 0.22,
      glide: 0.9,
      attack: 0.004,
      lowpass: 900,
      bed: { filter: 'lowpass', freq: 420, to: 200, q: 0.7, gain: 0.6, dur: 0.18 },
    },
    // A soft hush.
    shadow: {
      wave: 'sine',
      rootHz: 220,
      steps: [0, 3, -2],
      stepS: 0.16,
      noteS: 0.45,
      glide: 1,
      attack: 0.04,
      lowpass: 1200,
      bed: { filter: 'lowpass', freq: 520, to: 300, q: 0.6, gain: 0.45, dur: 0.6 },
    },
    // A glowy little bell run.
    light: {
      wave: 'sine',
      rootHz: 523,
      steps: [0, 4, 7, 12],
      stepS: 0.08,
      noteS: 0.5,
      glide: 1,
      attack: 0.004,
      lowpass: 4000,
      bed: null,
    },
  } satisfies Record<ElementId, BossStinger>, // TUNE: every one judged by ear on /sounds.html
} as const;

/**
 * How long a chest's crescendo builds before its chord, in seconds (#653), so
 * each lands as its own lid comes up and the treasure shows.
 */
export const CHEST_BUILD_S = {
  /** The bonus room's chest: its lid is up in 0.5 s and its card shows at 0.75 s. */
  chest: 0.62, // TUNE
  /** The attic's big chest: it wobbles for 0.65 s, then its lid swings open until 1.4 s. */
  'chest-big': 1.32, // TUNE
} as const;

/** localStorage key for this device's volumes. */
export const AUDIO_SETTINGS_KEY = 'heartpatch.audio.v1';
