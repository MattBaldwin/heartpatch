import type { CueName } from './cues.js';
import { SAMPLES, type SampleBank, type SampleId } from './samples.js';
import type { SfxKit } from './sfx.js';
import { bell, noise, tone } from './synth.js';
import { midiToHz } from './music-score.js';

// The big moments (#653, owner decision 2026-10-24): CC0 recorded hits
// (`samples.ts`, ASSETS.md), tuned to notes and layered with the synth's
// bells, swells and a soft reverb. A glassy mallet ("glint") carries the
// tunes, a coin chirp sparkles, a wooden knock and a low thump give weight.
// Cozy and bright, nothing sudden (style guide §7). The chest's crescendo is
// our own tune: a build that speeds up, a swell, then a bright chord with
// sparkles. Every timing and level here is a `// TUNE:` guess judged by ear.

export interface RecordedKit extends SfxKit {
  readonly samples: SampleBank;
}

interface Recording {
  /** The hits it layers; it only plays once all of them have loaded. */
  readonly needs: readonly SampleId[];
  /** Plays at `at` into `out`; returns how long it rings, in seconds. */
  readonly play: (
    kit: RecordedKit,
    out: AudioNode,
    at: number,
    pitch: number,
    gain: number,
  ) => number;
}

/** Plays one hit tuned to `midi`; returns how long it sounds. */
function hit(
  kit: RecordedKit,
  out: AudioNode,
  id: SampleId,
  at: number,
  midi: number,
  pitch: number,
  gain: number,
): number {
  const buffer = kit.samples.get(id);
  if (!buffer) return 0;
  const { ctx } = kit;
  const rate = pitch * 2 ** ((midi - SAMPLES[id].midi) / 12);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(rate, at);
  const level = ctx.createGain();
  level.gain.setValueAtTime(gain, at);
  source.connect(level);
  level.connect(out);
  source.start(at);
  source.onended = () => {
    source.disconnect();
    level.disconnect();
  };
  return buffer.duration / rate;
}

/** A run of glints, `times` (from `at`) paired with `notes`, getting a little louder. */
function run(
  kit: RecordedKit,
  out: AudioNode,
  at: number,
  times: readonly number[],
  notes: readonly number[],
  pitch: number,
  gain: number,
): void {
  times.forEach((t, i) => {
    const lift = 0.6 + (0.4 * i) / Math.max(1, times.length - 1);
    hit(kit, out, 'glint', at + t, notes[i] ?? 60, pitch, gain * lift);
  });
}

/** The payoff: glints on a chord, bells an octave and two up, and coin sparkles after. */
function payoff(
  kit: RecordedKit,
  out: AudioNode,
  at: number,
  chord: readonly number[],
  pitch: number,
  gain: number,
  sparkles: readonly number[],
): number {
  for (const midi of chord) hit(kit, out, 'glint', at, midi, pitch, gain * 0.4);
  chord.forEach((midi, i) => {
    bell(kit.ctx, out, at + i * 0.012, midiToHz(midi + 12) * pitch, gain * 0.13, 1.5);
    bell(kit.ctx, out, at + 0.04 + i * 0.012, midiToHz(midi + 24) * pitch, gain * 0.06, 1.1);
  });
  sparkles.forEach((midi, i) => {
    hit(kit, out, 'coin', at + 0.08 + i * 0.13, midi, pitch, gain * (0.28 - i * 0.035));
  });
  return 1.6 + sparkles.length * 0.13;
}

/** A soft swell under a build: a rising airy whoosh and a warm tone gliding up. */
function swell(
  kit: SfxKit,
  out: AudioNode,
  at: number,
  dur: number,
  from: number,
  to: number,
  gain: number,
): void {
  noise(kit.ctx, out, kit.noise, {
    at,
    dur: dur + 0.15,
    gain: gain * 0.16,
    filter: 'bandpass',
    freq: 400,
    to: 3200,
    q: 1.1,
    attack: dur * 0.85,
  });
  // One voice and its octave below: two detuned voices would beat and pulse.
  for (const [octave, level] of [
    [1, 0.14],
    [0.5, 0.1],
  ] as const) {
    tone(kit.ctx, out, {
      type: octave === 1 ? 'triangle' : 'sine',
      at,
      dur: dur + 0.3,
      freq: from * octave,
      to: to * octave,
      glide: dur,
      gain: gain * level,
      attack: dur * 0.8,
      lowpass: 2200,
      vibrato: [6, 0.01],
    });
  }
}

export const RECORDED: Readonly<Partial<Record<CueName, Recording>>> = {
  // The chest (#653): click-clack of the latch, a run up the C pentatonic that
  // speeds up over a swell, then a bright C chord with sparkles. About 2.3 s.
  chest: {
    needs: ['glint', 'coin', 'knock'],
    play: (kit, out, at, pitch, gain) => {
      hit(kit, out, 'knock', at, 74, pitch, gain * 0.5);
      hit(kit, out, 'knock', at + 0.09, 79, pitch, gain * 0.35);
      swell(kit, out, at + 0.12, 1.15, 262 * pitch, 523 * pitch, gain);
      run(
        kit,
        out,
        at,
        [0.2, 0.44, 0.64, 0.8, 0.93, 1.04, 1.13, 1.2],
        [60, 62, 64, 67, 69, 72, 74, 76],
        pitch,
        gain * 0.5,
      );
      return (
        1.32 + payoff(kit, out, at + 1.32, [60, 64, 67, 72], pitch, gain, [96, 91, 100, 93, 98])
      );
    },
  },

  // A power door wakes (#306): a low thump as it stirs, a hum rising, glints
  // up in fifths, then a G chord. About 2 s.
  'door-wake': {
    needs: ['glint', 'coin', 'thrum'],
    play: (kit, out, at, pitch, gain) => {
      hit(kit, out, 'thrum', at, 43, pitch, gain * 0.55);
      tone(kit.ctx, out, {
        type: 'sine',
        at,
        dur: 1.1,
        freq: 98 * pitch,
        to: 196 * pitch,
        glide: 0.8,
        gain: gain * 0.18,
        attack: 0.3,
        hold: 0.3,
      });
      run(kit, out, at, [0.25, 0.45, 0.6, 0.72], [55, 62, 67, 74], pitch, gain * 0.45);
      return 0.85 + payoff(kit, out, at + 0.85, [55, 59, 62, 67], pitch, gain * 0.9, [91, 95, 98]);
    },
  },

  // An evolution: a long swell with a quick glint run inside it, then the chord.
  evolve: {
    needs: ['glint', 'coin'],
    play: (kit, out, at, pitch, gain) => {
      swell(kit, out, at, 1.1, 300 * pitch, 900 * pitch, gain * 1.1);
      const notes = [60, 62, 64, 67, 69, 72, 74, 76, 79];
      run(
        kit,
        out,
        at,
        notes.map((_, i) => 0.3 + i * 0.09),
        notes,
        pitch,
        gain * 0.4,
      );
      return 1.2 + payoff(kit, out, at + 1.2, [60, 64, 67, 72], pitch, gain, [96, 100, 103]);
    },
  },

  // A new friend: a soft knock (the Heart Charm landing), a glint arpeggio up
  // a G chord, and a sparkle. About 1.4 s.
  charm: {
    needs: ['glint', 'coin', 'knock'],
    play: (kit, out, at, pitch, gain) => {
      hit(kit, out, 'knock', at, 67, pitch, gain * 0.3);
      run(kit, out, at, [0.06, 0.15, 0.24], [55, 59, 62], pitch, gain * 0.45);
      return 0.33 + payoff(kit, out, at + 0.33, [55, 59, 62, 67], pitch, gain * 0.8, [94, 98]);
    },
  },

  // A win: the old tune on glints (up, back and up again), then a chord and sparkles.
  yay: {
    needs: ['glint', 'coin'],
    play: (kit, out, at, pitch, gain) => {
      const notes = [60, 64, 67, 72, 67, 72];
      run(
        kit,
        out,
        at,
        notes.map((_, i) => i * 0.085),
        notes,
        pitch,
        gain * 0.45,
      );
      return 0.55 + payoff(kit, out, at + 0.55, [60, 64, 67, 76], pitch, gain * 0.85, [96, 100]);
    },
  },

  // A key turns up: a coin glint, two glints up a fourth ("ta-da"), a bell.
  'key-found': {
    needs: ['glint', 'coin'],
    play: (kit, out, at, pitch, gain) => {
      hit(kit, out, 'coin', at, 91, pitch, gain * 0.3);
      hit(kit, out, 'glint', at + 0.1, 64, pitch, gain * 0.4);
      hit(kit, out, 'glint', at + 0.24, 69, pitch, gain * 0.5);
      bell(kit.ctx, out, at + 0.24, midiToHz(81) * pitch, gain * 0.14, 1.3);
      bell(kit.ctx, out, at + 0.26, midiToHz(88) * pitch, gain * 0.06, 1);
      hit(kit, out, 'coin', at + 0.4, 98, pitch, gain * 0.18);
      return 1.55;
    },
  },

  // A room put right: a warm sigh of relief (a soft thump and a pad swelling),
  // glints climbing, then a chord that glows.
  'room-bloom': {
    needs: ['glint', 'coin', 'thrum'],
    play: (kit, out, at, pitch, gain) => {
      hit(kit, out, 'thrum', at, 48, pitch, gain * 0.3);
      for (const midi of [48, 55, 64]) {
        tone(kit.ctx, out, {
          type: 'triangle',
          at,
          dur: 2,
          freq: midiToHz(midi) * pitch,
          gain: gain * 0.07,
          attack: 0.5,
          hold: 0.6,
          lowpass: 1400,
        });
      }
      run(kit, out, at, [0.2, 0.32, 0.44], [64, 67, 72], pitch, gain * 0.45);
      return 0.6 + payoff(kit, out, at + 0.6, [60, 64, 67, 71], pitch, gain * 0.8, [96, 91]);
    },
  },
};

/** True when every hit a recording needs has loaded. */
export function canPlay(recording: Recording, samples: SampleBank): boolean {
  return recording.needs.every((id) => samples.has(id));
}
