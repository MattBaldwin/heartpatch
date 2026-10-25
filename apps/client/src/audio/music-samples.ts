import { MUSIC, VOICE_STYLES, type VoiceStyle } from './audio-config.js';
import type { Note } from './music-score.js';
import { decode, fetchBytes, type FetchBytes } from './samples.js';

// The music's real instruments (#664, owner 2026-10-25: "enrich the music
// just like we did the other sounds"): a few short CC0 notes from
// Versilian Studios' chamber orchestra (VSCO-2-CE, ASSETS.md), each pitched
// to the score's notes. They load after the first tap with the engine, are
// never precached, and until they're in (or if they never are) the synth
// plays the score as before (`synth.ts` playNote).

export type InstrumentId =
  'piano' | 'glock' | 'marimba' | 'harp' | 'strings' | 'bass' | 'pizz' | 'flute' | 'shaker';

export const INSTRUMENT_IDS: readonly InstrumentId[] = [
  'piano',
  'glock',
  'marimba',
  'harp',
  'strings',
  'bass',
  'pizz',
  'flute',
  'shaker',
];

/**
 * Each instrument's files, by the note they sound (`cs3` is C♯3; C4 = MIDI
 * 60). The shaker has no pitch: its files are two shakes, picked in turn.
 * Always real files (`no-inline`, like `samples.ts`): the CSP's
 * `connect-src` blocks fetching a `data:` URL.
 */
const FILES: Readonly<Record<InstrumentId, readonly string[]>> = {
  piano: ['c3', 'g3', 'c4', 'g4', 'c5', 'g5', 'c6'],
  glock: ['g5', 'c6', 'g6', 'c7'],
  marimba: ['g3', 'f4', 'c5', 'g5', 'b5'],
  harp: ['c3', 'g3', 'd4', 'a4', 'e5', 'b5'],
  strings: ['d3', 'f3', 'a3', 'c4', 'f4', 'a4', 'c5', 'e5'],
  bass: ['a2', 'cs3', 'e3', 'gs3'],
  pizz: ['g3', 'd4', 'a4', 'e5'],
  flute: ['c5', 'e5', 'a5', 'c6'],
  shaker: ['1', '2'],
};

const URLS = import.meta.glob<string>('./samples/music/*.m4a', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
});

const LETTERS: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** `cs3` → 49. Unpitched names (`1`) → their index from 0. */
export function noteMidi(name: string): number {
  const match = /^([a-g])(s?)(\d)$/.exec(name);
  if (!match) return Number(name) - 1;
  const [, letter = 'c', sharp, octave = '4'] = match;
  return (LETTERS[letter] ?? 0) + (sharp ? 1 : 0) + (Number(octave) + 1) * 12;
}

export interface InstrumentFile {
  readonly instrument: InstrumentId;
  readonly url: string;
  /** The note it sounds (MIDI), or its index for the shaker. */
  readonly midi: number;
}

export const INSTRUMENT_FILES: readonly InstrumentFile[] = INSTRUMENT_IDS.flatMap((instrument) =>
  FILES[instrument].map((name) => {
    const url = URLS[`./samples/music/${instrument}-${name}.m4a`];
    if (!url) throw new Error(`missing music sample ${instrument}-${name}`);
    return { instrument, url, midi: noteMidi(name) };
  }),
);

export interface InstrumentNote {
  readonly midi: number;
  readonly buffer: AudioBuffer;
  /** Seconds of encoder lead-in silence to skip, so every note lands on its beat. */
  readonly offset: number;
}

/** Each instrument's loaded notes, low to high. */
export type InstrumentBank = ReadonlyMap<InstrumentId, readonly InstrumentNote[]>;

/** Instruments with no pitch: each note picks a file by its MIDI number, at rate 1. */
const UNPITCHED: ReadonlySet<InstrumentId> = new Set(['shaker']);

/**
 * The loaded note nearest `midi`, and the playback rate that tunes it there.
 * Null if none of that instrument's notes loaded.
 */
export function pickNote(
  bank: InstrumentBank,
  instrument: InstrumentId,
  midi: number,
): { readonly note: InstrumentNote; readonly rate: number } | null {
  const notes = bank.get(instrument);
  if (!notes?.length) return null;
  if (UNPITCHED.has(instrument)) {
    const note = notes[Math.abs(Math.round(midi)) % notes.length];
    return note ? { note, rate: 1 } : null;
  }
  let best = notes[0];
  for (const note of notes) {
    if (best && Math.abs(note.midi - midi) < Math.abs(best.midi - midi)) best = note;
  }
  return best ? { note: best, rate: 2 ** ((midi - best.midi) / 12) } : null;
}

/** Where the sound starts: the first sample above a whisper, less 2 ms. */
export function leadIn(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, Math.round(buffer.sampleRate * 0.25));
  for (let i = 0; i < limit; i += 1) {
    if (Math.abs(data[i] ?? 0) > 0.002) return Math.max(0, i / buffer.sampleRate - 0.002);
  }
  return 0;
}

/**
 * Loads and decodes every note, resolving with the whole bank only once all
 * have settled, so a loop never renders from half the notes (a lone note
 * stretched octaves to cover the rest). A note that fails is left out (its
 * neighbours stretch a little to cover it; an instrument with none plays its
 * synth stand-in). Never rejects.
 *
 * Only `parallel` notes load at a time: 44 at once would take every
 * connection the browser allows the host (six over HTTP/1.1), and the
 * game's own requests (signing in, the lobby) would wait behind the music.
 */
export async function loadInstruments(
  ctx: BaseAudioContext,
  fetcher: FetchBytes = fetchBytes,
  parallel: number = MUSIC.loadParallel,
): Promise<InstrumentBank> {
  const bank = new Map<InstrumentId, InstrumentNote[]>();
  let next = 0;
  const worker = async () => {
    for (let file = INSTRUMENT_FILES[next++]; file; file = INSTRUMENT_FILES[next++]) {
      try {
        const buffer = await decode(ctx, await fetcher(file.url));
        const notes = bank.get(file.instrument) ?? [];
        notes.push({ midi: file.midi, buffer, offset: leadIn(buffer) });
        bank.set(file.instrument, notes);
      } catch {
        // Offline or undecodable: the synth stands in.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  for (const notes of bank.values()) notes.sort((a, b) => a.midi - b.midi);
  return bank;
}

/** Each voice's own level and tone (`VOICE_STYLES`): gain, then its lowpass, into `out`. */
export type VoiceBuses = ReadonlyMap<Note['voice'], AudioNode>;

export function voiceBuses(ctx: BaseAudioContext, out: AudioNode): VoiceBuses {
  const buses = new Map<Note['voice'], AudioNode>();
  for (const [voice, style] of Object.entries(VOICE_STYLES) as [Note['voice'], VoiceStyle][]) {
    const level = ctx.createGain();
    level.gain.value = style.gain;
    if (style.lowpass > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = style.lowpass;
      filter.Q.value = 0.5;
      level.connect(filter);
      filter.connect(out);
    } else {
      level.connect(out);
    }
    buses.set(voice, level);
  }
  return buses;
}

/**
 * Plays one note of a score on its sampled instrument (#664), `spb` seconds
 * per beat. False if that instrument hasn't loaded (the synth plays it).
 */
export function playSampled(
  ctx: BaseAudioContext,
  buses: VoiceBuses,
  bank: InstrumentBank,
  note: Note,
  spb: number,
): boolean {
  const style = VOICE_STYLES[note.voice];
  const out = buses.get(note.voice);
  const picked = pickNote(bank, style.instrument, note.midi);
  if (!picked || !out) return false;
  const { buffer, offset } = picked.note;
  const at = note.beat * spb;
  const ends = at + (buffer.duration - offset) / picked.rate;
  const release = at + note.beats * spb + style.ring;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = picked.rate;
  const env = ctx.createGain();
  if (style.attack > 0) {
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(note.velocity, at + style.attack);
  } else {
    env.gain.setValueAtTime(note.velocity, at);
  }
  let stop = ends;
  if (release < ends) {
    env.gain.setValueAtTime(note.velocity, Math.max(release, at + style.attack));
    env.gain.setTargetAtTime(0, Math.max(release, at + style.attack), style.release / 4);
    stop = Math.min(ends, release + style.release);
  }
  source.connect(env);
  env.connect(out);
  source.start(at, offset);
  source.stop(stop + 0.02);
  source.onended = () => {
    source.disconnect();
    env.disconnect();
  };
  return true;
}
