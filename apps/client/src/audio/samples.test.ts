import { describe, expect, it } from 'vitest';
import { canPlay, RECORDED } from './recorded.js';
import { loadSamples, SAMPLE_IDS, SAMPLES, type SampleId } from './samples.js';

/** A stand-in context: decodes any bytes into a tagged buffer, or fails on 'bad'. */
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
      const buffer = { duration: 0.2, tag } as unknown as AudioBuffer;
      ok(buffer);
      return Promise.resolve(buffer);
    },
  }) as unknown as BaseAudioContext;

const fetchTagged =
  (missing: ReadonlySet<SampleId> = new Set()) =>
  (url: string) => {
    const id = SAMPLE_IDS.find((s) => SAMPLES[s].url === url);
    if (!id || missing.has(id)) return Promise.reject(new Error('offline'));
    return Promise.resolve(new TextEncoder().encode(id).buffer);
  };

describe('recorded big moments (#653)', () => {
  it('ships an AAC file per hit, served by Vite', () => {
    for (const id of SAMPLE_IDS) expect(SAMPLES[id].url).toMatch(new RegExp(`${id}[^/]*\\.m4a`));
  });

  it('loads and decodes every hit', async () => {
    const bank = new Map<SampleId, AudioBuffer>();
    await loadSamples(fakeCtx(), bank, fetchTagged());
    expect([...bank.keys()].sort()).toEqual([...SAMPLE_IDS].sort());
  });

  it('leaves out a hit that fails to fetch or decode, without rejecting', async () => {
    const bank = new Map<SampleId, AudioBuffer>();
    await loadSamples(fakeCtx(new Set(['knock'])), bank, fetchTagged(new Set(['coin'])));
    expect([...bank.keys()].sort()).toEqual(['glint', 'thrum']);
  });

  it('records the chest, door, key, room, evolution, new friend and win', () => {
    expect(Object.keys(RECORDED).sort()).toEqual([
      'charm',
      'chest',
      'door-wake',
      'evolve',
      'key-found',
      'room-bloom',
      'yay',
    ]);
  });

  it('plays a recording only once all its hits are in (the synth stands in until then)', () => {
    const chest = RECORDED.chest;
    if (!chest) throw new Error('no chest');
    const some = new Map<SampleId, AudioBuffer>([['glint', {} as AudioBuffer]]);
    expect(canPlay(chest, some)).toBe(false);
    const all = new Map(SAMPLE_IDS.map((id) => [id, {} as AudioBuffer] as const));
    for (const recording of Object.values(RECORDED)) expect(canPlay(recording, all)).toBe(true);
  });
});
