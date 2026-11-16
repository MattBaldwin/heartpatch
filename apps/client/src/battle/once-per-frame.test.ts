import { describe, expect, it } from 'vitest';
import { oncePerFrame } from './once-per-frame.js';

/** A hand-cranked frame clock: `frame()` runs what was asked for this frame. */
function clock() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    schedule: (cb: () => void) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancel: (id: number) => {
      queue.delete(id);
    },
    frame: () => {
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb();
    },
    get waiting() {
      return queue.size;
    },
  };
}

describe('oncePerFrame', () => {
  it('turns many camera moves in one frame into one placement pass', () => {
    const c = clock();
    let passes = 0;
    const follow = oncePerFrame(() => (passes += 1), c.schedule, c.cancel);
    for (let i = 0; i < 12; i++) follow.mark();
    expect(c.waiting).toBe(1);
    c.frame();
    expect(passes).toBe(1);
    // Nothing moved since: no pass the next frame.
    c.frame();
    expect(passes).toBe(1);
  });

  it('gives the move after a pass a pass of its own, so the settled spot is shown', () => {
    const c = clock();
    let passes = 0;
    const follow = oncePerFrame(() => (passes += 1), c.schedule, c.cancel);
    follow.mark();
    c.frame();
    follow.mark();
    follow.mark();
    c.frame();
    expect(passes).toBe(2);
  });

  it('drops a pass that was cancelled before its frame', () => {
    const c = clock();
    let passes = 0;
    const follow = oncePerFrame(() => (passes += 1), c.schedule, c.cancel);
    follow.mark();
    follow.cancel();
    c.frame();
    expect(passes).toBe(0);
    follow.mark();
    c.frame();
    expect(passes).toBe(1);
  });
});
