import { describe, expect, it } from 'vitest';
import { ManualClock, realClock } from './battle-clock.js';

describe('ManualClock', () => {
  it('fires due timers in time order as it advances, and never runs backwards', () => {
    const clock = new ManualClock();
    const log: string[] = [];
    clock.later(500, () => log.push('b'));
    clock.later(200, () => log.push('a'));
    clock.later(200, () => log.push('a2'));
    clock.advance(100);
    expect(log).toEqual([]);
    clock.advance(150);
    expect(log).toEqual(['a', 'a2']);
    expect(clock.now()).toBe(250);
    clock.set(100);
    expect(clock.now()).toBe(250);
    clock.set(1000);
    expect(log).toEqual(['a', 'a2', 'b']);
    expect(clock.pending).toBe(0);
  });

  it('runs a timer set from inside a timer when its own time comes', () => {
    const clock = new ManualClock();
    const log: number[] = [];
    clock.later(100, () => {
      log.push(clock.now());
      clock.later(100, () => log.push(clock.now()));
    });
    clock.set(150);
    expect(log).toEqual([100]);
    clock.set(300);
    expect(log).toEqual([100, 200]);
  });

  it('cancels one timer or all of them', () => {
    const clock = new ManualClock();
    let fired = 0;
    const id = clock.later(10, () => fired++);
    clock.later(10, () => fired++);
    clock.cancel(id);
    clock.advance(20);
    expect(fired).toBe(1);
    clock.later(10, () => fired++);
    clock.clearAll();
    clock.advance(20);
    expect(fired).toBe(1);
  });
});

describe('realClock', () => {
  it('slows time and stretches timers by the slow-motion factor', () => {
    let t = 8000;
    const set: { fn: () => void; ms: number }[] = [];
    const cleared: number[] = [];
    const clock = realClock(8, {
      now: () => t,
      setTimeout: (fn, ms) => set.push({ fn, ms }),
      clearTimeout: (id) => cleared.push(id),
    });
    expect(clock.now()).toBe(1000);
    t = 16000;
    expect(clock.now()).toBe(2000);
    clock.later(100, () => undefined);
    expect(set[0]?.ms).toBe(800);
    clock.clearAll();
    expect(cleared).toEqual([1]);
  });
});
