import type { CueName } from './cues.js';
import { noise, tone } from './synth.js';

// The sound effects (#25), each a tiny synth recipe: squishy squeaks and
// giggles, boops, pops and chimes (style guide §7: soft, round and bouncy).
// The Hollow Man's arrival is a low, quiet hush, never a sting. `pitch` and
// `gain` carry the per-play variation, so repeats never sound copied.

export interface SfxKit {
  readonly ctx: BaseAudioContext;
  readonly noise: AudioBuffer;
}

/** Plays a cue at `at` into `out`; returns how long it rings, in seconds. */
export type Recipe = (
  kit: SfxKit,
  out: AudioNode,
  at: number,
  pitch: number,
  gain: number,
) => number;

/** A rising "eek" with a little vowel-ish filter: the squishy voice. */
function squeak(kit: SfxKit, out: AudioNode, at: number, base: number, gain: number): number {
  tone(kit.ctx, out, {
    type: 'sine',
    at,
    dur: 0.16,
    freq: base,
    to: base * 1.55,
    glide: 0.07,
    gain,
    attack: 0.006,
    vibrato: [28, 0.02],
  });
  tone(kit.ctx, out, {
    type: 'triangle',
    at,
    dur: 0.12,
    freq: base * 2,
    to: base * 3,
    glide: 0.06,
    gain: gain * 0.18,
    lowpass: 2600,
  });
  return 0.18;
}

/** Notes of a little arpeggio (semitones above `root`), `step` seconds apart. */
function chime(
  kit: SfxKit,
  out: AudioNode,
  at: number,
  root: number,
  steps: readonly number[],
  step: number,
  gain: number,
): number {
  steps.forEach((semis, i) => {
    const freq = root * 2 ** (semis / 12);
    const t = at + i * step;
    tone(kit.ctx, out, { type: 'sine', at: t, dur: 0.7, freq, gain, attack: 0.004 });
    tone(kit.ctx, out, { type: 'sine', at: t, dur: 0.25, freq: freq * 2.76, gain: gain * 0.2 });
  });
  return steps.length * step + 0.7;
}

export const RECIPES: Readonly<Record<CueName, Recipe>> = {
  tick: (kit, out, at, pitch, gain) => {
    tone(kit.ctx, out, {
      type: 'triangle',
      at,
      dur: 0.045,
      freq: 1500 * pitch,
      to: 1100 * pitch,
      gain: gain * 0.5,
      attack: 0.002,
      lowpass: 3000,
    });
    return 0.05;
  },

  boop: (kit, out, at, pitch, gain) => {
    tone(kit.ctx, out, {
      type: 'sine',
      at,
      dur: 0.16,
      freq: 620 * pitch,
      to: 330 * pitch,
      glide: 0.12,
      gain: gain * 0.8,
      attack: 0.004,
    });
    return 0.16;
  },

  squeak: (kit, out, at, pitch, gain) => squeak(kit, out, at, 880 * pitch, gain * 0.55),

  giggle: (kit, out, at, pitch, gain) => {
    // "Hee hee hee": three quick squeaks, each a touch higher.
    const lifts = [1, 1.12, 1.26];
    lifts.forEach((lift, i) => {
      squeak(kit, out, at + i * 0.11, 1000 * pitch * lift, gain * 0.45);
    });
    return 0.11 * lifts.length + 0.18;
  },

  nom: (kit, out, at, pitch, gain) => {
    for (const [i, f] of [320, 280].entries()) {
      tone(kit.ctx, out, {
        type: 'sine',
        at: at + i * 0.13,
        dur: 0.1,
        freq: f * pitch,
        to: f * pitch * 0.7,
        gain: gain * 0.8,
        attack: 0.004,
      });
    }
    return 0.25;
  },

  twinkle: (kit, out, at, pitch, gain) =>
    chime(kit, out, at, 1046 * pitch, [0, 4, 7], 0.07, gain * 0.32),

  evolve: (kit, out, at, pitch, gain) => {
    tone(kit.ctx, out, {
      type: 'triangle',
      at,
      dur: 0.9,
      freq: 300 * pitch,
      to: 1200 * pitch,
      glide: 0.8,
      gain: gain * 0.25,
      attack: 0.1,
      hold: 0.5,
      lowpass: 2200,
    });
    return Math.max(
      1,
      chime(kit, out, at + 0.7, 1046 * pitch, [0, 4, 7, 12, 16], 0.08, gain * 0.3),
    );
  },

  whoosh: (kit, out, at, pitch, gain) => {
    noise(kit.ctx, out, kit.noise, {
      at,
      dur: 0.28,
      gain: gain * 1.4,
      filter: 'bandpass',
      freq: 500 * pitch,
      to: 2400 * pitch,
      q: 1.4,
      attack: 0.08,
    });
    return 0.28;
  },

  bonk: (kit, out, at, pitch, gain) => {
    // A soft squish, like poking a beanbag.
    tone(kit.ctx, out, {
      type: 'sine',
      at,
      dur: 0.2,
      freq: 260 * pitch,
      to: 120 * pitch,
      glide: 0.15,
      gain: gain * 0.7,
      attack: 0.003,
    });
    noise(kit.ctx, out, kit.noise, {
      at,
      dur: 0.08,
      gain: gain * 0.3,
      filter: 'lowpass',
      freq: 1200,
    });
    return 0.2;
  },

  whiff: (kit, out, at, pitch, gain) => {
    noise(kit.ctx, out, kit.noise, {
      at,
      dur: 0.2,
      gain: gain * 0.22,
      filter: 'highpass',
      freq: 2000 * pitch,
      to: 5000 * pitch,
      attack: 0.03,
    });
    return 0.2;
  },

  sleepy: (kit, out, at, pitch, gain) => {
    // A long, drowsy slide down: "wheeeew".
    tone(kit.ctx, out, {
      type: 'sine',
      at,
      dur: 0.8,
      freq: 620 * pitch,
      to: 220 * pitch,
      glide: 0.75,
      gain: gain * 0.5,
      attack: 0.03,
      hold: 0.3,
      vibrato: [6, 0.03],
    });
    return 0.8;
  },

  pop: (kit, out, at, pitch, gain) => {
    tone(kit.ctx, out, {
      type: 'sine',
      at,
      dur: 0.09,
      freq: 400 * pitch,
      to: 900 * pitch,
      glide: 0.05,
      gain: gain * 0.7,
      attack: 0.002,
    });
    return 0.1;
  },

  charm: (kit, out, at, pitch, gain) =>
    chime(kit, out, at, 784 * pitch, [0, 4, 7, 12], 0.09, gain * 0.34),

  'wiggle-free': (kit, out, at, pitch, gain) => {
    // Boing-boing: two wobbly hops away.
    for (const i of [0, 1]) {
      tone(kit.ctx, out, {
        type: 'triangle',
        at: at + i * 0.16,
        dur: 0.14,
        freq: 300 * pitch,
        to: 520 * pitch,
        glide: 0.1,
        gain: gain * 0.4,
        vibrato: [18, 0.05],
        lowpass: 1800,
      });
    }
    return 0.32;
  },

  yay: (kit, out, at, pitch, gain) => {
    const end = chime(kit, out, at, 523 * pitch, [0, 4, 7, 12, 7, 12, 16], 0.085, gain * 0.32);
    squeak(kit, out, at + 0.62, 1100 * pitch, gain * 0.35);
    return end;
  },

  aww: (kit, out, at, pitch, gain) => {
    // Two soft notes, down a little: "aw-ww". Kind, not sad.
    for (const [i, f] of [440, 392].entries()) {
      tone(kit.ctx, out, {
        type: 'triangle',
        at: at + i * 0.22,
        dur: 0.38,
        freq: f * pitch,
        to: f * pitch * 0.94,
        gain: gain * 0.35,
        attack: 0.02,
        hold: 0.1,
        lowpass: 1600,
      });
    }
    return 0.6;
  },

  nightfall: (kit, out, at, pitch, gain) => {
    // A low hush (style guide §5: colour drains, music drops out). Two soft
    // detuned drones and a breath of wind, nothing sudden.
    for (const detune of [-9, 9]) {
      tone(kit.ctx, out, {
        type: 'sine',
        at,
        dur: 4,
        freq: 98 * pitch,
        detune,
        gain: gain * 0.28,
        attack: 1.2,
        hold: 1.2,
        vibrato: [0.7, 0.01],
      });
    }
    noise(kit.ctx, out, kit.noise, {
      at,
      dur: 3,
      gain: gain * 0.07,
      filter: 'bandpass',
      freq: 300,
      to: 700,
      q: 0.8,
      attack: 1.2,
    });
    return 4;
  },
};
