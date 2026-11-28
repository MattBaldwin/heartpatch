import { describe, expect, it } from 'vitest';
import { repoweredSinceMs } from './power-refresh.js';

const H = 60 * 60 * 1000;
/** Worked time in `[from, to)` with one homestead cut-off left out, as `productionAt` counts it. */
const worked = (from: number, to: number, pause: { fromMs: number; toMs: number | null } | null) =>
  to -
  from -
  (pause ? Math.max(0, Math.min(to, pause.toMs ?? Infinity) - Math.max(from, pause.fromMs)) : 0);

describe('repowering (Clockwork Isle #874)', () => {
  it('leaves out exactly the unpowered gap', () => {
    expect(repoweredSinceMs(0, 10 * H, 15 * H, null)).toBe(5 * H);
  });

  it('counts a homestead cut-off once when one capture cuts it off and unpowers it', () => {
    // Cut off and unpowered at 10h, joined back at 12h, repowered at 15h.
    const pause = { fromMs: 10 * H, toMs: 12 * H };
    const since = repoweredSinceMs(0, 10 * H, 15 * H, pause);
    expect(worked(since, 20 * H, pause)).toBe(10 * H + 5 * H);
  });

  it('counts a cut-off inside the powered stretch once', () => {
    const pause = { fromMs: 8 * H, toMs: 12 * H };
    const since = repoweredSinceMs(0, 10 * H, 15 * H, pause);
    expect(worked(since, 20 * H, pause)).toBe(worked(0, 10 * H, pause) + 5 * H);
  });

  it('keeps a short worked stretch across a long cut-off, ended or still going', () => {
    const cases: [number, number, number, { fromMs: number; toMs: number | null }][] = [
      // Worked 7h–10h, cut off and unpowered at 10h, rejoined and repowered at 34h.
      [7 * H, 10 * H, 34 * H, { fromMs: 10 * H, toMs: 34 * H }],
      // The same, still cut off when repowered (its own Windmill on the homestead).
      [7 * H, 10 * H, 34 * H, { fromMs: 10 * H, toMs: null }],
      // Ten minutes worked, a cut-off ending just before the repower.
      [0, H / 6, 15 * H, { fromMs: 10 * H, toMs: 14.9 * H }],
    ];
    for (const [since, off, at, pause] of cases) {
      const start = repoweredSinceMs(since, off, at, pause);
      expect(worked(start, at, pause)).toBe(worked(since, off, pause));
    }
  });
});
