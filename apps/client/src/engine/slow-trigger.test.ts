import { describe, expect, it } from 'vitest';
import { PAUSE_MS, REPORT_EVERY_MS, SLOW_FOR_MS, SlowTrigger } from './slow-trigger.js';

/** Feeds `ms` of frames, each `frameMs` long, from `start`; returns every run that fired and the end time. */
function play(trigger: SlowTrigger, start: number, ms: number, frameMs: number) {
  const fired = [];
  let now = start;
  while (now < start + ms) {
    now += frameMs;
    const run = trigger.frame(now, frameMs);
    if (run) fired.push({ at: now, ...run });
  }
  return { fired, now };
}

describe('SlowTrigger', () => {
  it('fires once drawn frames stay under 10 fps for 5 s', () => {
    const trigger = new SlowTrigger();
    const { fired } = play(trigger, 0, 5200, 200); // 5 fps
    expect(fired).toHaveLength(1);
    expect(fired[0]!.at).toBe(SLOW_FOR_MS);
    expect(fired[0]!.fps).toBeCloseTo(5);
    expect(fired[0]!.ms).toBe(SLOW_FOR_MS);
  });

  it('counts a phone stuck at 1 fps (one frame per second)', () => {
    const { fired } = play(new SlowTrigger(), 0, 5000, 1000);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.fps).toBeCloseTo(1);
  });

  it('never fires at 10 fps or more', () => {
    expect(play(new SlowTrigger(), 0, 30_000, 100).fired).toEqual([]);
    expect(play(new SlowTrigger(), 0, 30_000, 33).fired).toEqual([]);
  });

  it('starts over after a fast second', () => {
    const trigger = new SlowTrigger();
    let { now } = play(trigger, 0, 4000, 200); // 4 slow seconds
    ({ now } = play(trigger, now, 1000, 16)); // one smooth one
    expect(trigger.slowing).toBe(false);
    const { fired } = play(trigger, now, 4800, 200);
    expect(fired).toEqual([]);
    expect(play(trigger, now + 4800, 400, 200).fired).toHaveLength(1);
  });

  it('starts over after an idle stretch (no real frame time)', () => {
    const trigger = new SlowTrigger();
    const { now } = play(trigger, 0, 4000, 200);
    expect(trigger.slowing).toBe(true);
    expect(trigger.frame(now + 5000, null)).toBeNull();
    expect(trigger.slowing).toBe(false);
    expect(play(trigger, now + 5000, 4000, 200).fired).toEqual([]);
  });

  it('reads a frame spanning a pause (tab hidden, phone asleep) as a pause, not a slow frame', () => {
    const trigger = new SlowTrigger();
    expect(trigger.frame(60_000, 60_000)).toBeNull();
    expect(trigger.frame(60_000 + PAUSE_MS + 1, PAUSE_MS + 1)).toBeNull();
    expect(trigger.slowing).toBe(false);
  });

  it('fires at most once a minute while it stays slow, then again', () => {
    const trigger = new SlowTrigger();
    const { fired } = play(trigger, 0, REPORT_EVERY_MS + 10_000, 200);
    expect(fired.map((f) => f.at)).toEqual([SLOW_FOR_MS, SLOW_FOR_MS + REPORT_EVERY_MS]);
  });

  it('keeps the once-a-minute limit across a reset (a new scene)', () => {
    const trigger = new SlowTrigger();
    let { now } = play(trigger, 0, 5000, 200);
    trigger.reset();
    const again = play(trigger, now, 10_000, 200);
    expect(again.fired).toEqual([]);
    now = again.now;
    expect(play(trigger, now, REPORT_EVERY_MS, 200).fired).toHaveLength(1);
  });
});
