import { describe, expect, it } from 'vitest';
import { FRAME_CAP_30 } from './config.js';
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

  it('draws one frame per requestFrame, so a 30 fps pacer gets about 30 fps', () => {
    const s = new FrameScheduler(2);
    run(s, 5, () => false);
    // A 60 Hz loop for one second; breathing asks for a frame every other
    // tick (a 30 fps interval less half a tick, see BREATHING_FRAME_MS).
    const askEveryMs = 29; // BREATHING_FRAME_MS in src/battle/battle-config.ts
    let lastAsk = -Infinity;
    let draws = 0;
    for (let i = 0; i < 60; i++) {
      const t = 1000 + i * (1000 / 60);
      if (t - lastAsk >= askEveryMs) {
        lastAsk = t;
        s.requestFrame();
      }
      if (s.next(t, false).draw) draws++;
    }
    expect(draws).toBeGreaterThanOrEqual(28);
    expect(draws).toBeLessThanOrEqual(31);
    // The same pacer with invalidate() draws two frames per ask: nearly every frame.
    const i2 = new FrameScheduler(2);
    run(i2, 5, () => false);
    lastAsk = -Infinity;
    let settleDraws = 0;
    for (let i = 0; i < 60; i++) {
      const t = 1000 + i * (1000 / 60);
      if (t - lastAsk >= askEveryMs) {
        lastAsk = t;
        i2.invalidate();
      }
      if (i2.next(t, false).draw) settleDraws++;
    }
    expect(settleDraws).toBeGreaterThan(50);
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

  it('under a cap draws every other 60 Hz frame and reports their real gap', () => {
    const s = new FrameScheduler(2, FRAME_CAP_30);
    const vsync = 1000 / 60;
    const frames = Array.from({ length: 9 }, (_, i) => s.next(i * vsync, true));
    expect(frames.map((f) => f.draw)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    const gaps = frames.filter((f) => f.draw).map((f) => f.frameMs);
    expect(gaps[0]).toBeNull();
    for (const gap of gaps.slice(1)) expect(gap).toBeCloseTo(2 * vsync);
    expect(s.idle).toBe(false);
  });

  it('keeps a request that came too soon under a cap for the next allowed frame', () => {
    const s = new FrameScheduler(1, FRAME_CAP_30);
    run(s, 1, () => false);
    s.requestFrame();
    expect(s.next(16, false).draw).toBe(false);
    expect(s.next(32, false).draw).toBe(true);
    expect(s.next(48, false).draw).toBe(false);
  });

  it('keeps its 30 fps slots when a drawn frame runs late (60 Hz)', () => {
    const s = new FrameScheduler(1, FRAME_CAP_30);
    const vsync = 1000 / 60;
    // Every drawn callback runs 7 ms late; the ones between run on time.
    const drawn = Array.from({ length: 60 }, (_, i) => {
      s.requestFrame();
      return s.next(i * vsync + (i % 2 === 0 ? 7 : 0), true).draw;
    });
    expect(drawn.filter(Boolean)).toHaveLength(30);
  });

  it('starts a fresh schedule after an idle stretch', () => {
    const s = new FrameScheduler(1, FRAME_CAP_30);
    expect(s.next(0, true).draw).toBe(true);
    expect(s.next(1000, true).draw).toBe(true);
    expect(s.next(1016, true).draw).toBe(false);
    expect(s.next(1033, true).draw).toBe(true);
  });
});
