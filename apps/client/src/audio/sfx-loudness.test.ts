import { describe, expect, it, vi } from 'vitest';
import { CUE_NAMES, type CueName } from './cues.js';

// Node has no Web Audio, so this can't hear a cue (lane 1b's pattern for the
// music, `music-score.test.ts`): it records every voice a recipe starts and
// adds up the levels of the voices sounding at each moment. That sum is an
// upper bound on the cue's peak, which is enough to keep the BIG squishies'
// sounds no louder than a win's `yay` (#190 PR 4). `/sounds.html`'s
// `check()` measures the real rendered peaks by ear's proxy.

interface Voice {
  at: number;
  dur: number;
  gain: number;
}
const voices: Voice[] = [];

vi.mock('./synth.js', () => ({
  tone: (_ctx: unknown, _out: unknown, spec: Voice) => {
    voices.push({ at: spec.at, dur: spec.dur, gain: spec.gain });
  },
  noise: (_ctx: unknown, _out: unknown, _buffer: unknown, spec: Voice) => {
    voices.push({ at: spec.at, dur: spec.dur, gain: spec.gain });
  },
  // The real bell's five partials add up to 1.38 of its level.
  bell: (_ctx: unknown, _out: unknown, at: number, _freq: number, gain: number, ring = 0.9) => {
    voices.push({ at, dur: ring, gain: gain * 1.38 });
  },
}));

const { RECIPES } = await import('./sfx.js');

/** The loudest moment's summed level, and how long the cue says it rings. */
function bound(cue: CueName): { peak: number; rings: number } {
  voices.length = 0;
  const kit = { ctx: {}, noise: {} } as never;
  const rings = RECIPES[cue](kit, {} as never, 0, 1, 1);
  let peak = 0;
  const last = Math.max(rings, ...voices.map((v) => v.at + v.dur));
  for (let t = 0; t <= last; t += 0.005) {
    const sum = voices
      .filter((v) => v.at <= t && t < v.at + v.dur)
      .reduce((total, v) => total + v.gain, 0);
    peak = Math.max(peak, sum);
  }
  return { peak, rings };
}

const BOSS_CUES = CUE_NAMES.filter((c) => c.startsWith('boss-'));

describe('the BIG squishies are no louder than a win (#190 PR 4)', () => {
  const yay = bound('yay').peak;

  it('measures something for yay', () => {
    expect(yay).toBeGreaterThan(0.5);
  });

  it('has the windup and landing for every element, plus backup and tuckered out', () => {
    expect(BOSS_CUES).toHaveLength(8 * 2 + 2);
  });

  it.each(BOSS_CUES)('%s peaks no higher than yay, and makes a sound', (cue) => {
    const { peak, rings } = bound(cue);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(yay);
    // Every voice it starts is inside the length it reports (the engine frees it then).
    expect(rings).toBeGreaterThan(0.3);
    for (const v of voices) expect(v.at + v.dur).toBeLessThanOrEqual(rings + 1e-9);
  });
});
