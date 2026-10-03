// Tunable numbers for sound and music (#25, tech spec §15). Everything is
// synthesised in the browser (Web Audio), so there are no files to license.

/** Bus levels at full slider, before the player's own volume. Quiet by default. */
export const MIX = {
  music: 0.22, // TUNE: music sits well under the squeaks
  sfx: 0.55, // TUNE
  ui: 0.3, // TUNE: button ticks are a whisper
  /** The limiter on the master bus (a hard-knee compressor). */
  limiterThresholdDb: -8, // TUNE
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
} as const;

export const SFX = {
  /** Most voices sounding at once; extra cues are dropped (a tap storm stays polite). */
  maxVoices: 10, // TUNE
  /** The same cue again sooner than this is dropped. */
  minRepeatS: 0.05, // TUNE
  /** Random pitch spread per play (± fraction), so repeats don't sound copied. */
  pitchJitter: 0.06, // TUNE
  /** Random volume spread per play (fraction off the top). */
  gainJitter: 0.15, // TUNE
} as const;

/** localStorage key for this device's volumes. */
export const AUDIO_SETTINGS_KEY = 'heartpatch.audio.v1';
