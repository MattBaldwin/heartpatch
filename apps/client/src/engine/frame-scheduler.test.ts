import { describe, expect, it } from 'vitest';
import { FrameScheduler } from './frame-scheduler.js';

/** Runs loop iterations 16 ms apart; `busy(i)` says whether iteration i animates. */
function run(s: FrameScheduler, n: number, busy: (i: number) => boolean, t0 = 0) {
  const out: { draw: boolean; frameMs: number | null }[] = [];
  for (let i = 0; i < n; i++) out.push(s.next(t0 + i * 16, busy(i)));
  return out;
}

describe('FrameScheduler', () => {
  it('draws the first frames, then stops while nothing changes', () => {
    const s = new FrameScheduler(2);
    const frames = run(s, 10, () => false);
    expect(frames.map((f) => f.draw)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(s.idle).toBe(true);
    expect(s.draws).toBe(2);
  });

  it('draws every frame while busy (camera moving, fling, animation)', () => {
    const s = new FrameScheduler(2);
    run(s, 5, () => false);
    const frames = run(s, 6, () => true, 1000);
    expect(frames.every((f) => f.draw)).toBe(true);
    expect(s.idle).toBe(false);
  });

  it('draws a few settle frames after an invalidation', () => {
    const s = new FrameScheduler(2);
    run(s, 5, () => false);
    s.invalidate();
    const frames = run(s, 4, () => false, 1000);
    expect(frames.map((f) => f.draw)).toEqual([true, true, false, false]);
  });

  it('reports frame times only between consecutive drawn frames', () => {
    const s = new FrameScheduler(1);
    expect(s.next(0, true).frameMs).toBeNull(); // first frame ever
    expect(s.next(16, true).frameMs).toBe(16);
    expect(s.next(33, true).frameMs).toBe(17);
    expect(s.next(50, false).draw).toBe(false); // idle…
    expect(s.next(5000, false).draw).toBe(false);
    // …so the first frame after idle is not a 5-second "slow frame".
    expect(s.next(5016, true).frameMs).toBeNull();
    expect(s.next(5032, true).frameMs).toBe(16);
  });

  it('does not stack invalidations beyond the settle count', () => {
    const s = new FrameScheduler(2);
    run(s, 3, () => false);
    s.invalidate();
    s.invalidate();
    s.invalidate();
    expect(run(s, 4, () => false, 1000).filter((f) => f.draw)).toHaveLength(2);
  });
});
