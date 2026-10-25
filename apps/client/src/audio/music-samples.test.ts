import { describe, expect, it } from 'vitest';
import { VOICE_STYLES } from './audio-config.js';
import {
  INSTRUMENT_FILES,
  INSTRUMENT_IDS,
  leadIn,
  loadInstruments,
  noteMidi,
  pickNote,
  type InstrumentId,
  type InstrumentNote,
} from './music-samples.js';
import { SCORES } from './music-score.js';

/** A stand-in context: decodes bytes into a tagged buffer, or fails on 'bad'. */
const fakeCtx = (bad: ReadonlySet<string> = new Set()) =>
  ({
    decodeAudioData: (
      bytes: ArrayBuffer,
      ok: (b: AudioBuffer) => void,
      fail: (e: Error) => void,
    ): Promise<AudioBuffer> => {
      const tag = new TextDecoder().decode(bytes);
      if (bad.has(tag)) {
        fail(new Error('undecodable'));
        return Promise.reject(new Error('undecodable'));
      }
      const data = new Float32Array(100);
      data[10] = 0.5;
      const buffer = {
        duration: 1,
        sampleRate: 1000,
        tag,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
      ok(buffer);
      return Promise.resolve(buffer);
    },
  }) as unknown as BaseAudioContext;

const fetchTagged =
  (missing: ReadonlySet<string> = new Set()) =>
  (url: string) => {
    if (missing.has(url)) return Promise.reject(new Error('offline'));
    return Promise.resolve(new TextEncoder().encode(url).buffer);
  };

const note = (midi: number): InstrumentNote => ({ midi, buffer: {} as AudioBuffer, offset: 0 });

describe('music instruments (#664)', () => {
  it('names notes the MIDI way (C4 = 60)', () => {
    expect(noteMidi('c4')).toBe(60);
    expect(noteMidi('cs3')).toBe(49);
    expect(noteMidi('a4')).toBe(69);
    expect(noteMidi('b5')).toBe(83);
    expect(noteMidi('2')).toBe(1);
  });

  it('ships an AAC file for every note (the folder and its budget: tooling/music-capture)', () => {
    expect(INSTRUMENT_FILES).toHaveLength(44);
    for (const file of INSTRUMENT_FILES) {
      expect(file.url).toMatch(new RegExp(`${file.instrument}-[a-z0-9]+[^/]*\\.m4a`));
    }
  });

  it('gives every score voice an instrument with notes, in range of what it plays', () => {
    for (const style of Object.values(VOICE_STYLES)) {
      expect(INSTRUMENT_IDS).toContain(style.instrument);
    }
    for (const score of Object.values(SCORES)) {
      for (const n of score.notes) {
        const { instrument } = VOICE_STYLES[n.voice];
        if (instrument === 'shaker') continue;
        const pitches = INSTRUMENT_FILES.filter((f) => f.instrument === instrument).map(
          (f) => f.midi,
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

  it('loads every note, low to high per instrument', async () => {
    const bank = await loadInstruments(fakeCtx(), fetchTagged());
    expect([...bank.keys()].sort()).toEqual([...INSTRUMENT_IDS].sort());
    for (const notes of bank.values()) {
      const pitches = notes.map((n) => n.midi);
      expect(pitches).toEqual([...pitches].sort((a, b) => a - b));
    }
    expect(bank.get('piano')?.[0]?.offset).toBeCloseTo(0.008);
  });

  it('leaves out notes that fail, without rejecting', async () => {
    const piano = INSTRUMENT_FILES.filter((f) => f.instrument === 'piano');
    const harp = INSTRUMENT_FILES.filter((f) => f.instrument === 'harp');
    const bank = await loadInstruments(
      fakeCtx(new Set(harp.map((f) => f.url))),
      fetchTagged(new Set([piano[0]?.url ?? ''])),
    );
    expect(bank.has('harp')).toBe(false);
    expect(bank.get('piano')).toHaveLength(piano.length - 1);
  });

  it('downloads only a couple of notes at a time, leaving connections for the game', async () => {
    let inFlight = 0;
    let most = 0;
    const fetcher = async (url: string) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return fetchTagged()(url);
    };
    const bank = await loadInstruments(fakeCtx(), fetcher, 2);
    expect(most).toBe(2);
    expect([...bank.values()].reduce((n, notes) => n + notes.length, 0)).toBe(44);
  });

  it('hands over no notes until every one has settled (a loop never hears half a bank)', async () => {
    const last = INSTRUMENT_FILES[INSTRUMENT_FILES.length - 1]?.url;
    let release = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = async (url: string) => {
      if (url === last) await slow;
      return fetchTagged()(url);
    };
    let bank: unknown = null;
    const loading = loadInstruments(fakeCtx(), fetcher).then((b) => {
      bank = b;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bank).toBeNull();
    release();
    await loading;
    expect(bank).toBeInstanceOf(Map);
  });
});
