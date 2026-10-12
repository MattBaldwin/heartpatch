import { describe, expect, it } from 'vitest';
import { HOUSE_FLICKER } from './house-config.js';
import { createFlicker, flickerAt } from './house-flicker.js';

/** Hand-driven timers and page visibility. */
function harness() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  let hidden = false;
  const listeners = new Set<() => void>();
  const applied: [number, number][] = [];
  let frames = 0;
  const flicker = createFlicker({
    apply: (fire, lamp) => applied.push([fire, lamp]),
    frame: () => {
      frames += 1;
    },
    hidden: () => hidden,
    onVisibility: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setInterval: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id as number);
    },
    now: () => 1.25,
  });
  return {
    flicker,
    timers,
    applied,
    listeners,
    get frames() {
      return frames;
    },
    tick: () => {
      for (const t of [...timers.values()]) t.fn();
    },
    setHidden: (h: boolean) => {
      hidden = h;
      for (const cb of [...listeners]) cb();
    },
  };
}

describe('the fire flicker (#381 H2)', () => {
  it('stays close to the steady light, the lamp gentler than the fire', () => {
    for (let t = 0; t < 5; t += 0.05) {
      const fire = flickerAt(t, HOUSE_FLICKER.depth.fire);
      expect(Math.abs(fire - 1)).toBeLessThanOrEqual(HOUSE_FLICKER.depth.fire + 1e-9);
      expect(Math.abs(flickerAt(t, HOUSE_FLICKER.depth.lamp) - 1)).toBeLessThanOrEqual(
        HOUSE_FLICKER.depth.lamp + 1e-9,
      );
    }
  });

  it('ticks on a slow timer, one frame a tick, never per frame', () => {
    const h = harness();
    h.flicker.start(9);
    expect(h.flicker.running).toBe(true);
    expect([...h.timers.values()].map((t) => Math.round(t.ms))).toEqual([111]);
    h.tick();
    h.tick();
    expect(h.flicker.ticks).toBe(2);
    expect(h.frames).toBe(2);
    expect(h.applied).toHaveLength(2);
  });

  it('stops when the house hides, and puts the steady light back', () => {
    const h = harness();
    h.flicker.start(9);
    h.tick();
    h.flicker.stop();
    expect(h.flicker.running).toBe(false);
    expect(h.timers.size).toBe(0);
    expect(h.listeners.size).toBe(0);
    expect(h.applied.at(-1)).toEqual([1, 1]);
    const ticks = h.flicker.ticks;
    h.tick();
    expect(h.flicker.ticks).toBe(ticks);
  });

  it('pauses while the tab is in the background and comes back with it', () => {
    const h = harness();
    h.flicker.start(8);
    h.setHidden(true);
    expect(h.flicker.running).toBe(false);
    expect(h.timers.size).toBe(0);
    expect(h.applied.at(-1)).toEqual([1, 1]);
    const frames = h.frames;
    h.tick();
    expect(h.frames).toBe(frames);
    h.setHidden(false);
    expect(h.flicker.running).toBe(true);
    h.tick();
    expect(h.frames).toBe(frames + 1);
  });

  it('never starts on a hidden page, and stays still at 0 Hz (the low tier)', () => {
    const h = harness();
    h.setHidden(true);
    h.flicker.start(9);
    expect(h.flicker.running).toBe(false);
    const low = harness();
    low.flicker.start(HOUSE_FLICKER.hz.low);
    expect(low.flicker.running).toBe(false);
    expect(low.timers.size).toBe(0);
    expect(low.frames).toBe(0);
  });

  it('restarting at a new rate keeps one timer', () => {
    const h = harness();
    h.flicker.start(9);
    h.flicker.start(8);
    expect(h.timers.size).toBe(1);
    expect(h.listeners.size).toBe(1);
    h.flicker.start(0);
    expect(h.timers.size).toBe(0);
  });
});
