import { describe, expect, it } from 'vitest';
import { SCALER, type ScalerConfig } from '../config.js';
import { initialGovernor, stepGovernor, type GovernorState } from './governor.js';

const config: ScalerConfig = {
  ...SCALER,
  targetFps: 60,
  windowMs: 500,
  lowerBelowFps: 55,
  raiseAtFps: 58,
  step: 0.05,
  raiseAfterMs: 3000,
  maxRaiseAfterMs: 12_000,
  flapWindowMs: 2000,
  maxFrameMs: 250,
  tierDropAfterMs: 3000,
  tierDropBelowFps: 50,
};
const ctx = { config, devicePixelRatio: 2 };

/** Feeds `ms` worth of frames at a steady frame rate. */
function run(state: GovernorState, fps: number, ms: number): GovernorState {
  const frameMs = 1000 / fps;
  let s = state;
  for (let t = 0; t < ms; t += frameMs) s = stepGovernor(s, frameMs, ctx);
  return s;
}

describe('stepGovernor', () => {
  it('leaves a device holding 60 fps at full resolution', () => {
    const s = run(initialGovernor('high', config), 60, 20_000);
    expect(s.renderScale).toBe(1);
    expect(s.tier).toBe('high');
  });

  it('lowers resolution within one window when the frame rate dips', () => {
    const s = run(initialGovernor('high', config), 50, 520);
    expect(s.renderScale).toBeLessThan(1);
    // ~sqrt(50/60) ≈ 0.913: a proportional cut, not a crawl.
    expect(s.renderScale).toBeCloseTo(0.913, 2);
  });

  it('steps at least `step` even for a small dip', () => {
    const s = run(initialGovernor('high', config), 54.9, 520);
    expect(s.renderScale).toBe(0.95);
  });

  it('never goes below the tier floor', () => {
    const s = run(initialGovernor('high', config), 20, 2000);
    expect(s.renderScale).toBe(0.75);
  });

  it('steps the tier down when stuck at the floor and still slow', () => {
    let s = run(initialGovernor('high', config), 30, 1000);
    expect(s.renderScale).toBe(0.75);
    expect(s.tier).toBe('high');
    s = run(s, 30, 3100);
    expect(s.tier).toBe('medium');
    s = run(s, 30, 3100);
    expect(s.tier).toBe('low');
    expect(s.renderScale).toBe(0.75);
    s = run(s, 30, 10_000);
    expect(s.tier).toBe('low');
    expect(s.renderScale).toBe(0.7);
  });

  it('does not drop a tier for frame rates that are only a little low', () => {
    const s = run(initialGovernor('high', config), 52, 20_000);
    expect(s.renderScale).toBe(0.75);
    expect(s.tier).toBe('high');
  });

  it('raises resolution again after sustained headroom', () => {
    let s = run(initialGovernor('high', config), 45, 520);
    const lowered = s.renderScale;
    s = run(s, 60, 2900);
    expect(s.renderScale).toBe(lowered);
    s = run(s, 60, 600);
    expect(s.renderScale).toBeCloseTo(lowered + 0.05, 5);
    s = run(s, 60, 20_000);
    expect(s.renderScale).toBe(1);
  });

  it('backs off when a raise immediately causes a drop (no flapping)', () => {
    // Frame times that fill each 500 ms window exactly, so no window mixes rates.
    const windows = (state: GovernorState, frameMs: 12.5 | 20, count: number) => {
      let st = state;
      for (let i = 0; i < (count * 500) / frameMs; i++) st = stepGovernor(st, frameMs, ctx);
      return st;
    };
    const fast = 12.5;
    const slow = 20;

    let s = windows(initialGovernor('high', config), slow, 1);
    const lowered = s.renderScale;
    s = windows(s, fast, 6); // 3 s of headroom → raise
    expect(s.renderScale).toBeCloseTo(lowered + 0.05, 5);
    s = windows(s, slow, 1); // dropped straight after the raise
    expect(s.raiseAfterMs).toBe(6000);
    s = windows(s, fast, 6);
    expect(s.sinceRaiseMs).toBeNull(); // waits longer this time
    s = windows(s, fast, 6);
    expect(s.sinceRaiseMs).toBe(0);
    s = windows(s, slow, 1);
    expect(s.raiseAfterMs).toBe(12_000);
    s = windows(s, fast, 24);
    s = windows(s, slow, 1);
    expect(s.raiseAfterMs).toBe(12_000); // capped

    // A drop long after a raise is just load, not flapping.
    let t = windows(initialGovernor('high', config), slow, 1);
    t = windows(t, fast, 6); // raise
    t = windows(t, fast, 5); // 2.5 s later
    t = windows(t, slow, 1);
    expect(t.renderScale).toBeLessThan(1);
    expect(t.raiseAfterMs).toBe(3000);
  });

  it('ignores long gaps such as a hidden tab', () => {
    const s0 = initialGovernor('high', config);
    expect(stepGovernor(s0, 5000, ctx)).toBe(s0);
    expect(stepGovernor(s0, 0, ctx)).toBe(s0);
    expect(stepGovernor(s0, Number.NaN, ctx)).toBe(s0);
  });

  it('never scales a 1x screen', () => {
    let s = initialGovernor('high', config);
    for (let i = 0; i < 300; i++) s = stepGovernor(s, 1000 / 20, { config, devicePixelRatio: 1 });
    expect(s.renderScale).toBe(1);
  });
});
