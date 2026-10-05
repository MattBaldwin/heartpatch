import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityTier } from '../engine/config.js';
import { AmbientDriver, type AmbientTarget } from './ambient-driver.js';
import { ambientMode, type AmbientMode } from './ambient-layout.js';

/** A stand-in scene that follows `ambientMode` like `MapScene` does. */
class FakeScene implements AmbientTarget {
  ambientMode: AmbientMode = 'live';
  ticks = 0;
  setAmbient(tier: QualityTier, reducedMotion: boolean): boolean {
    const next = ambientMode({ tier, reducedMotion, slow: false });
    const changed = next !== this.ambientMode;
    this.ambientMode = next;
    return changed;
  }
  tick(): boolean {
    if (this.ambientMode !== 'live') return false;
    this.ticks++;
    return true;
  }
}

/** A controllable reduced-motion media query. */
function media(matches = false) {
  const listeners: (() => void)[] = [];
  return {
    matches,
    addEventListener: (_: 'change', fn: () => void) => {
      listeners.push(fn);
    },
    set(on: boolean) {
      this.matches = on;
      for (const fn of listeners) fn();
    },
  };
}

describe('AmbientDriver', () => {
  let now = 0;
  let frames: ((t: number) => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => frames.push(fn));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Runs `n` display frames 16.7 ms apart. */
  function run(n: number): void {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      const due = frames;
      frames = [];
      for (const fn of due) fn(now);
    }
  }

  function setup(tier: QualityTier = 'high', reduced = false) {
    const scene = new FakeScene();
    const requestFrame = vi.fn();
    const invalidate = vi.fn();
    const mq = media(reduced);
    let t = tier;
    const driver = new AmbientDriver({
      target: () => scene,
      requestFrame,
      invalidate,
      tier: () => t,
      reducedMotion: mq,
    });
    return { scene, driver, requestFrame, invalidate, mq, setTier: (n: QualityTier) => (t = n) };
  }

  it('asks for about 30 frames a second while live', () => {
    const { driver, requestFrame } = setup();
    driver.start();
    run(60);
    expect(requestFrame.mock.calls.length).toBeGreaterThanOrEqual(28);
    expect(requestFrame.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it('stops asking at once under reduced motion, and starts again after', () => {
    const { driver, requestFrame, invalidate, mq } = setup();
    driver.start();
    run(10);
    mq.set(true);
    expect(invalidate).toHaveBeenCalled();
    const asked = requestFrame.mock.calls.length;
    run(60);
    expect(requestFrame.mock.calls.length).toBe(asked);
    mq.set(false);
    run(10);
    expect(requestFrame.mock.calls.length).toBeGreaterThan(asked);
  });

  it('notices the tier dropping to low on its slow check', () => {
    const { driver, requestFrame, setTier } = setup();
    driver.start();
    setTier('low');
    vi.advanceTimersByTime(600);
    const asked = requestFrame.mock.calls.length;
    run(60);
    expect(requestFrame.mock.calls.length).toBe(asked);
  });

  it('asks for nothing once stopped', () => {
    const { driver, requestFrame } = setup();
    driver.start();
    driver.stop();
    run(60);
    vi.advanceTimersByTime(2000);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('tells a new scene how to start', () => {
    expect(setup('medium', true).driver.state).toEqual({ tier: 'medium', reducedMotion: true });
  });
});
