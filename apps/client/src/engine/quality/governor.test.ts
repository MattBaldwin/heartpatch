import { describe, expect, it } from 'vitest';
import { SCALER, type QualityTier, type ScalerConfig } from '../config.js';
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
  graceMs: 2000,
  cutGain: 1.04,
  capTolerance: 0.08,
  capHoldMs: 20_000,
  maxCapHoldMs: 80_000,
  tierRaiseAfterMs: 10_000,
  maxTierRaiseAfterMs: 40_000,
  tierFlapWindowMs: 10_000,
};
const ctx = { config, devicePixelRatio: 2 };

/** Relative GPU cost of each tier (bloom costs on high and medium). */
const TIER_COST: Record<QualityTier, number> = { high: 1, medium: 0.75, low: 0.6 };

/**
 * A simulated device: each frame takes the longest of the refresh cap, the
 * CPU time, and the GPU time (which scales with pixel count and tier cost).
 */
interface Device {
  /** Refresh-rate cap: 60 normally, 30 in iOS Low Power Mode. */
  capFps?: number;
  cpuMs?: number;
  /** GPU time per frame at full resolution on the high tier. */
  gpuMs?: number;
  tierCost?: Record<QualityTier, number>;
}

function frameMs(s: GovernorState, d: Device): number {
  const cap = 1000 / (d.capFps ?? 60);
  const gpu = (d.gpuMs ?? 0) * s.renderScale ** 2 * (d.tierCost ?? TIER_COST)[s.tier];
  return Math.max(cap, d.cpuMs ?? 0, gpu);
}

/** Runs `ms` of frames on a device and returns the final state and the scales seen. */
function simulate(state: GovernorState, d: Device, ms: number) {
  let s = state;
  const scales: number[] = [];
  for (let t = 0; t < ms;) {
    const f = frameMs(s, d);
    s = stepGovernor(s, f, ctx);
    scales.push(s.renderScale);
    t += f;
  }
  return { state: s, scales, fps: 1000 / frameMs(s, d) };
}

const start = (tier: QualityTier = 'high') => initialGovernor(tier, config);
const share = (xs: number[], pred: (x: number) => boolean) => xs.filter(pred).length / xs.length;

describe('stepGovernor on simulated devices', () => {
  it('leaves a device holding 60 fps alone', () => {
    const { state } = simulate(start(), { gpuMs: 12 }, 60_000);
    expect(state.renderScale).toBe(1);
    expect(state.tier).toBe('high');
  });

  it('ignores slow frames during the start-up grace window', () => {
    let s = start();
    for (let i = 0; i < 60; i++) s = stepGovernor(s, 30, ctx); // 1.8 s at 33 fps
    expect(s.renderScale).toBe(1);
    expect(s.windowFrames).toBe(0);
  });

  it('trades a little resolution for 60 fps on a lightly GPU-bound device', () => {
    const { state, fps } = simulate(start(), { gpuMs: 20 }, 20_000); // 50 fps at full res
    expect(state.tier).toBe('high');
    expect(state.renderScale).toBeLessThan(1);
    expect(state.renderScale).toBeGreaterThanOrEqual(0.75);
    expect(fps).toBeGreaterThanOrEqual(55);
  });

  it('steps the tier down only when the floor still is not enough', () => {
    // 28 fps at full res; still ~45 fps at the high floor; fine on medium.
    const { state, fps } = simulate(start(), { gpuMs: 36 }, 30_000);
    expect(state.tier).not.toBe('high');
    expect(fps).toBeGreaterThanOrEqual(50);
  });

  it('keeps full quality under a 30 fps cap (iOS Low Power Mode)', () => {
    const { state, scales } = simulate(start(), { capFps: 30, gpuMs: 10 }, 120_000);
    expect(state.tier).toBe('high');
    expect(state.renderScale).toBe(1);
    // It may re-test the cap briefly now and then, but stays sharp nearly always.
    expect(share(scales, (x) => x === 1)).toBeGreaterThan(0.9);
  });

  it('keeps full quality when the CPU, not the GPU, is the bottleneck', () => {
    const { state, scales } = simulate(start(), { cpuMs: 24, gpuMs: 8 }, 120_000);
    expect(state.tier).toBe('high');
    expect(share(scales, (x) => x === 1)).toBeGreaterThan(0.9);
  });

  it('recovers resolution and tier after a heavy spell (e.g. thermal dip)', () => {
    const heavy = simulate(start(), { gpuMs: 40 }, 15_000).state;
    expect(heavy.tier).not.toBe('high');
    const { state } = simulate(heavy, { gpuMs: 10 }, 120_000);
    expect(state.tier).toBe('high');
    expect(state.renderScale).toBe(1);
  });

  it('keeps the tier under Low Power Mode even when the GPU is also busy', () => {
    // Too slow at full res, capped at 30 once trimmed: the trim helps, dropping
    // bloom wouldn't, so the tier stays.
    for (const gpuMs of [36, 40]) {
      const { state } = simulate(start(), { capFps: 30, gpuMs }, 120_000);
      expect(state.tier).toBe('high');
      expect(state.renderScale).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('keeps the tier on a capped 1x screen (nothing to probe with but the tier)', () => {
    let s = start();
    const ctx1 = { config, devicePixelRatio: 1 };
    for (let i = 0; i < 3600; i++) s = stepGovernor(s, 1000 / 30, ctx1);
    expect(s.tier).toBe('high');
  });

  it('re-tests a held cap less and less often', () => {
    const { state, scales } = simulate(start(), { capFps: 30, gpuMs: 10 }, 300_000);
    expect(state.capHoldMs).toBe(config.maxCapHoldMs);
    const dips = scales.filter((x, i) => x < 1 && (scales[i - 1] ?? 1) === 1).length;
    // 20 s, 40 s, 80 s, 80 s… → a handful of re-tests in 5 minutes, not 15.
    expect(dips).toBeLessThanOrEqual(6);
  });

  it('notices new load while holding at a cap', () => {
    const capped = simulate(start(), { capFps: 30, gpuMs: 10 }, 10_000).state;
    expect(capped.cap).not.toBeNull();
    // GPU load now dominates (≈20 fps at full res): it must start cutting again.
    const { state } = simulate(capped, { capFps: 30, gpuMs: 50 }, 3000);
    expect(state.renderScale).toBeLessThan(1);
  });

  it('never recovers above the tier the player chose', () => {
    const { state } = simulate(start('medium'), { gpuMs: 5 }, 120_000);
    expect(state.tier).toBe('medium');
  });

  it('backs off tier raises when the better tier keeps failing', () => {
    // Fine on medium at full res, too slow on high even at the floor.
    const d = { gpuMs: 15, tierCost: { high: 3, medium: 1, low: 0.8 } };
    let s = simulate(start(), d, 20_000).state;
    expect(s.tier).toBe('medium');
    const first = s.tierRaiseAfterMs;
    s = simulate(s, d, 60_000).state;
    expect(s.tierRaiseAfterMs).toBeGreaterThan(first);
    expect(s.tierRaiseAfterMs).toBeLessThanOrEqual(config.maxTierRaiseAfterMs);
  });

  it('never scales a 1x screen', () => {
    let s = start();
    for (let i = 0; i < 600; i++) s = stepGovernor(s, 1000 / 20, { config, devicePixelRatio: 1 });
    expect(s.renderScale).toBe(1);
  });
});

describe('stepGovernor details', () => {
  /** Skips the grace period so a test starts measuring at once. */
  const ready = (tier: QualityTier = 'high') => ({ ...start(tier), elapsedMs: config.graceMs });
  /** Whole 500 ms windows at an exact frame time, so no window mixes rates. */
  const windows = (s: GovernorState, frame: 12.5 | 20 | 25, count: number) => {
    let st = s;
    for (let i = 0; i < (count * 500) / frame; i++) st = stepGovernor(st, frame, ctx);
    return st;
  };

  it('cuts in proportion to the shortfall, at least one step, never below the floor', () => {
    expect(windows(ready(), 20, 1).renderScale).toBeCloseTo(Math.sqrt(50 / 60), 2);
    expect(windows(ready(), 25, 1).renderScale).toBeCloseTo(Math.sqrt(40 / 60), 2);
    expect(windows({ ...ready(), renderScale: 0.78 }, 25, 1).renderScale).toBe(0.75);
  });

  it('discards the window after a change, then judges the cut', () => {
    let s = windows(ready(), 20, 1); // cut, probe set
    expect(s.settleWindows).toBe(1);
    s = windows(s, 20, 1); // settle window: no decision
    expect(s.probe).not.toBeNull();
    s = windows(s, 20, 1); // still 50 fps: the cut didn't help
    expect(s.renderScale).toBe(1);
    expect(s.cap?.fps).toBeCloseTo(50);
  });

  it('backs off resolution raises that immediately cause a drop', () => {
    let s: GovernorState = { ...ready(), renderScale: 0.9 };
    s = windows(s, 12.5, 6); // 3 s of headroom → raise
    expect(s.renderScale).toBeCloseTo(0.95, 5);
    s = windows(s, 12.5, 1); // settle
    s = windows(s, 20, 1); // dropped right after the raise
    expect(s.raiseAfterMs).toBe(6000);
  });

  it('ignores long gaps such as a hidden tab', () => {
    const s0 = ready();
    expect(stepGovernor(s0, 5000, ctx)).toBe(s0);
    expect(stepGovernor(s0, 0, ctx)).toBe(s0);
    expect(stepGovernor(s0, Number.NaN, ctx)).toBe(s0);
  });
});
