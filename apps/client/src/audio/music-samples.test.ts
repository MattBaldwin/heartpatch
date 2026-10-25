import { describe, expect, it } from 'vitest';
import { VOICE_STYLES } from './audio-config.js';
import { MUSIC_NOTES, MUSIC_NOTES_LEAD_S } from './music-notes.js';
import {
  INSTRUMENT_IDS,
  leadIn,
  loadInstruments,
  MUSIC_NOTES_URL,
  noteMidi,
  pickNote,
  sliceNotes,
  type InstrumentId,
  type InstrumentNote,
} from './music-samples.js';
import { SCORES } from './music-score.js';

const RATE = 1000;

/** A decoded file whose first sound starts `extra` seconds later than the packed one's. */
const fakeFile = (extra = 0): AudioBuffer => {
  const data = new Float32Array(RATE);
  data[Math.round((MUSIC_NOTES_LEAD_S + 0.002 + extra) * RATE)] = 0.5;
  return { duration: 110, sampleRate: RATE, getChannelData: () => data } as unknown as AudioBuffer;
};

/** A stand-in context that decodes anything into `fakeFile()`, or fails. */
const fakeCtx = (fails = false) =>
  ({
    decodeAudioData: (
      _bytes: ArrayBuffer,
      ok: (b: AudioBuffer) => void,
      fail: (e: Error) => void,
    ): Promise<AudioBuffer> => {
      if (fails) {
        fail(new Error('undecodable'));
        return Promise.reject(new Error('undecodable'));
      }
      const buffer = fakeFile();
      ok(buffer);
      return Promise.resolve(buffer);
    },
  }) as unknown as BaseAudioContext;

const note = (midi: number): InstrumentNote => ({
  midi,
  buffer: {} as AudioBuffer,
  offset: 0,
  length: 1,
});

describe('music instruments (#664)', () => {
  it('names notes the MIDI way (C4 = 60)', () => {
    expect(noteMidi('c4')).toBe(60);
    expect(noteMidi('cs3')).toBe(49);
    expect(noteMidi('a4')).toBe(69);
    expect(noteMidi('b5')).toBe(83);
    expect(noteMidi('2')).toBe(1);
  });

  it('packs 44 notes, every instrument, in order and without overlaps', () => {
    expect(MUSIC_NOTES).toHaveLength(44);
    expect(new Set(MUSIC_NOTES.map(([instrument]) => instrument))).toEqual(new Set(INSTRUMENT_IDS));
    let end = 0;
    for (const [, , start, length] of MUSIC_NOTES) {
      expect(start).toBeGreaterThan(end);
      expect(length).toBeGreaterThan(0.1);
      end = start + length;
    }
    expect(MUSIC_NOTES_URL).toMatch(/music-notes[^/]*\.m4a/);
  });

  it('gives every score voice an instrument with notes, in range of what it plays', () => {
    for (const style of Object.values(VOICE_STYLES)) {
      expect(INSTRUMENT_IDS).toContain(style.instrument);
    }
    for (const score of Object.values(SCORES)) {
      for (const n of score.notes) {
        const { instrument } = VOICE_STYLES[n.voice];
        if (instrument === 'shaker') continue;
        const pitches = MUSIC_NOTES.filter(([i]) => i === instrument).map(([, name]) =>
          noteMidi(name),
        );
        const nearest = Math.min(...pitches.map((p) => Math.abs(p - n.midi)));
        // Stretched further than this, a real instrument starts to sound odd.
        expect(nearest, `${score.id} ${n.voice} ${String(n.midi)}`).toBeLessThanOrEqual(9);
      }
    }
  });

  it('picks the nearest loaded note and tunes it there', () => {
    const bank = new Map<InstrumentId, readonly InstrumentNote[]>([
      ['piano', [note(48), note(55), note(60)]],
    ]);
    expect(pickNote(bank, 'piano', 55)).toEqual({ note: note(55), rate: 1 });
    const up = pickNote(bank, 'piano', 62);
    expect(up?.note.midi).toBe(60);
    expect(up?.rate).toBeCloseTo(2 ** (2 / 12));
    expect(pickNote(bank, 'piano', 50)?.note.midi).toBe(48);
    expect(pickNote(bank, 'harp', 60)).toBeNull();
  });

  it('takes turns between the shakes, never retuned', () => {
    const bank = new Map<InstrumentId, readonly InstrumentNote[]>([['shaker', [note(0), note(1)]]]);
    expect(pickNote(bank, 'shaker', 60)).toEqual({ note: note(0), rate: 1 });
    expect(pickNote(bank, 'shaker', 61)).toEqual({ note: note(1), rate: 1 });
  });

  it('skips a note’s silent lead-in', () => {
    const data = new Float32Array(1000);
    data[200] = 0.3;
    const buffer = { sampleRate: 1000, getChannelData: () => data } as unknown as AudioBuffer;
    expect(leadIn(buffer)).toBeCloseTo(0.198);
  });

  it('slices every note from the one file, low to high per instrument', () => {
    const bank = sliceNotes(fakeFile());
    expect([...bank.keys()].sort()).toEqual([...INSTRUMENT_IDS].sort());
    let count = 0;
    for (const notes of bank.values()) {
      const pitches = notes.map((n) => n.midi);
      expect(pitches).toEqual([...pitches].sort((a, b) => a - b));
      count += notes.length;
    }
    expect(count).toBe(44);
    const [, , start, length] = MUSIC_NOTES[0];
    const first = bank.get('piano')?.[0];
    expect(first?.offset).toBeCloseTo(start);
    expect(first?.length).toBe(length);
  });

  it('shifts every note when a decoder keeps the encoder lead-in', () => {
    const late = sliceNotes(fakeFile(0.1));
    expect(late.get('piano')?.[0]?.offset).toBeCloseTo(MUSIC_NOTES[0][2] + 0.1, 2);
  });

  it('loads with one download, and hands over the whole bank', async () => {
    const urls: string[] = [];
    const bank = await loadInstruments(fakeCtx(), (url) => {
      urls.push(url);
      return Promise.resolve(new ArrayBuffer(8));
    });
    expect(urls).toEqual([MUSIC_NOTES_URL]);
    expect([...bank.values()].reduce((n, notes) => n + notes.length, 0)).toBe(44);
  });

  it('hands over an empty bank (the synth plays) when the file fails, without rejecting', async () => {
    const offline = await loadInstruments(fakeCtx(), () => Promise.reject(new Error('offline')));
    expect(offline.size).toBe(0);
    const garbled = await loadInstruments(fakeCtx(true), () => Promise.resolve(new ArrayBuffer(8)));
    expect(garbled.size).toBe(0);
  });
});
