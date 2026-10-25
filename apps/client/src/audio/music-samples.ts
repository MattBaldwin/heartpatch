import musicNotesUrl from './samples/music-notes.m4a?url&no-inline';
import { MUSIC_NOTES, MUSIC_NOTES_LEAD_S } from './music-notes.js';
import { VOICE_STYLES, type VoiceStyle } from './audio-config.js';
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
 * Every note lives in one file (`tooling/music-notes/pack.mjs`): one
 * download and one decode, not 44, so the music never crowds out the game's
 * own requests or ties up the decoder. Always a real file (`no-inline`, like
 * `samples.ts`): the CSP's `connect-src` blocks fetching a `data:` URL.
 */
export const MUSIC_NOTES_URL = musicNotesUrl;

const LETTERS: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** `cs3` → 49. Unpitched names (the shaker's `1`, `2`) → their index from 0. */
export function noteMidi(name: string): number {
  const match = /^([a-g])(s?)(\d)$/.exec(name);
  if (!match) return Number(name) - 1;
  const [, letter = 'c', sharp, octave = '4'] = match;
  return (LETTERS[letter] ?? 0) + (sharp ? 1 : 0) + (Number(octave) + 1) * 12;
}

export interface InstrumentNote {
  /** The note it sounds (MIDI), or its index for the shaker. */
  readonly midi: number;
  /** The whole file of notes; this one is a slice of it. */
  readonly buffer: AudioBuffer;
  /** Where the note starts in `buffer`, and how long it runs, in seconds. */
  readonly offset: number;
  readonly length: number;
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
  const limit = Math.min(data.length, Math.round(buffer.sampleRate * 0.5));
  for (let i = 0; i < limit; i += 1) {
    if (Math.abs(data[i] ?? 0) > 0.002) return Math.max(0, i / buffer.sampleRate - 0.002);
  }
  return 0;
}

/** A decoder's extra lead-in is never more than this (AAC primes ~0.1 s at 22 kHz). */
const MAX_SHIFT_S = 0.25;

/** Slices the decoded file into each instrument's notes, low to high. */
export function sliceNotes(buffer: AudioBuffer): InstrumentBank {
  const found = leadIn(buffer) - MUSIC_NOTES_LEAD_S;
  const shift = Math.abs(found) <= MAX_SHIFT_S ? found : 0;
  const bank = new Map<InstrumentId, InstrumentNote[]>();
  for (const [instrument, name, start, length] of MUSIC_NOTES) {
    const notes = bank.get(instrument) ?? [];
    notes.push({ midi: noteMidi(name), buffer, offset: start + shift, length });
    bank.set(instrument, notes);
  }
  for (const notes of bank.values()) notes.sort((a, b) => a.midi - b.midi);
  return bank;
}

/**
 * Loads and decodes the notes, resolving with the whole bank at once, so a
 * loop never renders from half of it; empty if the file can't be had
 * (offline on a first visit), and every voice plays its synth stand-in.
 * Never rejects.
 */
export async function loadInstruments(
  ctx: BaseAudioContext,
  fetcher: FetchBytes = fetchBytes,
): Promise<InstrumentBank> {
  try {
    return sliceNotes(await decode(ctx, await fetcher(MUSIC_NOTES_URL)));
  } catch {
    return new Map();
  }
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
  const { buffer, offset, length } = picked.note;
  const at = note.beat * spb;
  const ends = at + length / picked.rate;
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
