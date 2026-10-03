import type { Note } from './music-score.js';
import { midiToHz } from './music-score.js';

// Small Web Audio building blocks (#25): an enveloped oscillator and a
// filtered noise burst. The sound effects and the music loops are both made
// from these, on the live context and on an OfflineAudioContext. Every node
// disconnects itself when it ends, so nothing piles up.

const SILENT = 0.0001;

export interface ToneSpec {
  readonly type: OscillatorType;
  /** Start time on the context's clock. */
  readonly at: number;
  /** Total length, attack to silence. */
  readonly dur: number;
  readonly freq: number;
  /** Glide to this pitch by `at + glide`. */
  readonly to?: number;
  readonly glide?: number;
  readonly gain: number;
  readonly attack?: number;
  /** Hold at full level for this long before fading (default: fade at once). */
  readonly hold?: number;
  /** Vibrato: rate in Hz and depth as a fraction of the pitch. */
  readonly vibrato?: readonly [rate: number, depth: number];
  /** A lowpass to round the edges off (Hz). */
  readonly lowpass?: number;
  readonly detune?: number;
}

/** Plays one enveloped oscillator into `out`. */
export function tone(ctx: BaseAudioContext, out: AudioNode, spec: ToneSpec): void {
  const { at, dur, freq } = spec;
  const attack = spec.attack ?? 0.008;
  const end = at + dur;
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(freq, at);
  if (spec.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.to, at + (spec.glide ?? dur));
  }
  if (spec.detune) osc.detune.setValueAtTime(spec.detune, at);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(spec.gain, at + attack);
  const fadeFrom = at + attack + (spec.hold ?? 0);
  env.gain.setValueAtTime(spec.gain, fadeFrom);
  env.gain.exponentialRampToValueAtTime(SILENT, Math.max(end, fadeFrom + 0.01));
  const nodes: AudioNode[] = [osc, env];
  let last: AudioNode = osc;
  if (spec.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(spec.lowpass, at);
    osc.connect(filter);
    last = filter;
    nodes.push(filter);
  }
  last.connect(env);
  env.connect(out);
  if (spec.vibrato) {
    const [rate, depth] = spec.vibrato;
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(rate, at);
    const amount = ctx.createGain();
    amount.gain.setValueAtTime(freq * depth, at);
    lfo.connect(amount);
    amount.connect(osc.frequency);
    nodes.push(lfo, amount);
    lfo.start(at);
    lfo.stop(end + 0.05);
  }
  osc.start(at);
  osc.stop(end + 0.05);
  osc.onended = () => {
    for (const node of nodes) node.disconnect();
  };
}

export interface NoiseSpec {
  readonly at: number;
  readonly dur: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  readonly to?: number;
  readonly q?: number;
  readonly attack?: number;
}

/** A burst of filtered white noise (whooshes, sniffs, soft clicks). */
export function noise(
  ctx: BaseAudioContext,
  out: AudioNode,
  buffer: AudioBuffer,
  spec: NoiseSpec,
): void {
  const { at, dur } = spec;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  // Long bursts wrap around; each starts somewhere random so none repeat exactly.
  src.loop = true;
  const offset = Math.random() * buffer.duration;
  const filter = ctx.createBiquadFilter();
  filter.type = spec.filter;
  filter.Q.setValueAtTime(spec.q ?? 1, at);
  filter.frequency.setValueAtTime(spec.freq, at);
  if (spec.to !== undefined) filter.frequency.exponentialRampToValueAtTime(spec.to, at + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(spec.gain, at + (spec.attack ?? 0.01));
  env.gain.exponentialRampToValueAtTime(SILENT, at + dur);
  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(at, offset, dur + 0.05);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    env.disconnect();
  };
}

/** One second of white noise, made once per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The music's instruments: one note of a score, `spb` seconds per beat. */
export function playNote(ctx: BaseAudioContext, out: AudioNode, note: Note, spb: number): void {
  const at = note.beat * spb;
  const len = note.beats * spb;
  const freq = midiToHz(note.midi);
  const v = note.velocity;
  switch (note.voice) {
    case 'pad': {
      for (const detune of [-7, 7]) {
        tone(ctx, out, {
          type: 'triangle',
          at,
          dur: len + 0.8,
          freq,
          detune,
          gain: v * 0.16,
          attack: Math.min(0.6, len * 0.4),
          hold: Math.max(0, len - 0.6),
          lowpass: 1400,
        });
      }
      return;
    }
    case 'bass': {
      tone(ctx, out, { type: 'sine', at, dur: len + 0.3, freq, gain: v * 0.5, attack: 0.01 });
      tone(ctx, out, { type: 'triangle', at, dur: 0.25, freq, gain: v * 0.12, lowpass: 900 });
      return;
    }
    case 'pluck': {
      tone(ctx, out, { type: 'triangle', at, dur: 0.45, freq, gain: v * 0.45, attack: 0.004 });
      // A woody tick on top.
      tone(ctx, out, {
        type: 'sine',
        at,
        dur: 0.06,
        freq: freq * 4,
        gain: v * 0.12,
        attack: 0.002,
      });
      return;
    }
    case 'bell': {
      tone(ctx, out, { type: 'sine', at, dur: 1.6, freq, gain: v * 0.4, attack: 0.004 });
      tone(ctx, out, { type: 'sine', at, dur: 0.5, freq: freq * 2.76, gain: v * 0.12 });
      tone(ctx, out, { type: 'sine', at, dur: 0.18, freq: freq * 5.4, gain: v * 0.06 });
      return;
    }
    case 'whistle': {
      tone(ctx, out, {
        type: 'sine',
        at,
        dur: len + 0.25,
        freq,
        gain: v * 0.4,
        attack: 0.07,
        hold: Math.max(0, len - 0.1),
        vibrato: [5.2, 0.012],
      });
      return;
    }
  }
}
