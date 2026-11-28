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
});
