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
  /** The music's soft room (#664): a little more than the SFX, so the instruments bloom. */
  musicReverb: 0.3, // TUNE
} as const;

/** What a new device starts with (sliders are 0–1). */
export const DEFAULT_VOLUMES = {
  music: 0.6, // TUNE
  sounds: 0.8, // TUNE
} as const;

export const MUSIC = {
  /** Cross-fade between day, night and Halloween loops. */
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
   * would pass `peak`, so day, night and Halloween sit at one level (#664).
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
