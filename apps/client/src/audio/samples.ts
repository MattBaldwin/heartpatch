import coinUrl from './samples/coin.m4a?url&no-inline';
import glintUrl from './samples/glint.m4a?url&no-inline';
import knockUrl from './samples/knock.m4a?url&no-inline';
import thrumUrl from './samples/thrum.m4a?url&no-inline';

// Recorded sounds for the big moments (#653, owner decision 2026-10-24:
// "CC0 recordings for the big moments, synthesis for the rest"). A few short
// CC0 hits (ASSETS.md), tuned and layered with the synth in `recorded.ts`.
// They load after the first tap, with the engine; until they have decoded, or
// if they never do, each big moment plays its synth version instead.

export type SampleId = 'glint' | 'coin' | 'knock' | 'thrum';

export const SAMPLE_IDS: readonly SampleId[] = ['glint', 'coin', 'knock', 'thrum'];

/**
 * Each hit's file, and the note it sounds at (MIDI), so a composition can
 * tune it: a glassy mallet, a rising coin chirp, a wooden knock and a low
 * thump. Always real files (`no-inline`): the CSP's `connect-src` would block
 * fetching a `data:` URL. Vite fingerprints them, and the service worker
 * doesn't precache them (only `assets/**\/*.{js,css}`), so they cost nothing
 * until a tap.
 */
export const SAMPLES: Readonly<Record<SampleId, { readonly url: string; readonly midi: number }>> =
  {
    glint: { url: glintUrl, midi: 56 },
    coin: { url: coinUrl, midi: 89 },
    knock: { url: knockUrl, midi: 74 },
    thrum: { url: thrumUrl, midi: 55 },
  };

export type SampleBank = ReadonlyMap<SampleId, AudioBuffer>;

/** Fetches a file's bytes (tests pass a fake). */
export type FetchBytes = (url: string) => Promise<ArrayBuffer>;

export const fetchBytes: FetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${String(response.status)} ${url}`);
  return response.arrayBuffer();
};

/** Old Safari only has the callback form of `decodeAudioData`. */
export function decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const pending = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
    pending?.catch(reject);
  });
}

/**
 * Loads and decodes every hit into `bank` as it arrives. One that fails is
 * left out (its moments stay synthesised); this never rejects.
 */
export async function loadSamples(
  ctx: BaseAudioContext,
  bank: Map<SampleId, AudioBuffer>,
  fetcher: FetchBytes = fetchBytes,
): Promise<void> {
  await Promise.all(
    SAMPLE_IDS.map(async (id) => {
      try {
        bank.set(id, await decode(ctx, await fetcher(SAMPLES[id].url)));
      } catch {
        // Offline or undecodable: the synth stands in.
      }
    }),
  );
}
