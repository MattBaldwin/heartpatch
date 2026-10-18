import { describe, expect, it } from 'vitest';
import { SCALER, type QualityTier, type ScalerConfig } from '../config.js';
import {
  cappedScaler,
  initialGovernor,
  resumeGovernor,
  stepGovernor,
  type GovernorState,
} from './governor.js';
import { renderScaleFloor } from './tiers.js';

const config: ScalerConfig = {
  ...SCALER,
  targetFps: 60,
  windowMs: 500,
  lowerBelowFps: 55,
  raiseAtFps: 58,
  step: 0.05,
  minCutStep: 0.1,
  settleWindows: 2,
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
  tierProbeCooldownMs: 120_000,
  tierRaiseAfterMs: 10_000,
  maxTierRaiseAfterMs: 40_000,
  tierFlapWindowMs: 10_000,
};
const ctx = { config, devicePixelRatio: 2 };

/** Relative GPU cost of each tier (bloom costs on high and medium). */
const TIER_COST: Record<QualityTier, number> = { high: 1, medium: 0.75, low: 0.6 };
/** Relative cost of the tier's resolution-independent effects (bloom passes, extras). */
const EFFECTS_COST: Record<QualityTier, number> = { high: 1, medium: 0.5, low: 0.3 };

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
  /** GPU time per frame that doesn't scale with pixels (effects), on the high tier. */
  effectsMs?: number;
  tierCost?: Record<QualityTier, number>;
}

function frameMs(s: GovernorState, d: Device): number {
  const cap = 1000 / (d.capFps ?? 60);
  const gpu = (d.gpuMs ?? 0) * s.renderScale ** 2 * (d.tierCost ?? TIER_COST)[s.tier];
  const effects = (d.effectsMs ?? 0) * EFFECTS_COST[s.tier];
  return Math.max(cap, d.cpuMs ?? 0, gpu + effects);
}

/** Runs `ms` of frames on a device and returns the final state and the scales and tiers seen. */
function simulate(state: GovernorState, d: Device, ms: number) {
  let s = state;
  const scales: number[] = [];
  const tiers: QualityTier[] = [];
  for (let t = 0; t < ms;) {
    const f = frameMs(s, d);
    s = stepGovernor(s, f, ctx);
    scales.push(s.renderScale);
    tiers.push(s.tier);
    t += f;
  }
  return { state: s, scales, tiers, fps: 1000 / frameMs(s, d) };
}

/** Times the tier stepped down from high (each a probe on a capped or CPU-bound device). */
const tierProbes = (tiers: QualityTier[]) =>
  tiers.filter((x, i) => x !== 'high' && (tiers[i - 1] ?? 'high') === 'high').length;

const start = (tier: QualityTier = 'high') => initialGovernor(tier, config);
const share = <T>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length / xs.length;

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

  it('drops a tier when its effects, not its pixels, hold the frame rate down (#501)', () => {
    // 28 fps on high whatever the resolution (a team at the lake on an
    // iPhone): a cut doesn't help, so it probes medium instead of holding at
    // full resolution, and keeps it because that helps.
    const device = { effectsMs: 36 };
    expect(1000 / frameMs(start(), device)).toBeLessThan(29);
    const { state, fps } = simulate(start(), device, 30_000);
    expect(state.tier).not.toBe('high');
    expect(fps).toBeGreaterThanOrEqual(50);
  });

  it('keeps full quality under a 30 fps cap (iOS Low Power Mode)', () => {
    const { state, scales, tiers } = simulate(start(), { capFps: 30, gpuMs: 10 }, 120_000);
    expect(state.tier).toBe('high');
    expect(state.renderScale).toBe(1);
    // It may re-test the cap briefly now and then, but stays sharp nearly always.
    expect(share(scales, (x) => x === 1)).toBeGreaterThan(0.9);
    // Each re-test below tierProbeBelowFps also probes a tier down and puts it
    // back (#501): one reverted probe per re-test, on the cap's back-off.
    expect(share(tiers, (x) => x === 'high')).toBeGreaterThan(0.95);
    expect(tierProbes(tiers)).toBeLessThanOrEqual(4);
  });

  it('keeps full quality when the CPU, not the GPU, is the bottleneck', () => {
    const { state, scales, tiers } = simulate(start(), { cpuMs: 24, gpuMs: 8 }, 120_000);
    expect(state.tier).toBe('high');
    expect(share(scales, (x) => x === 1)).toBeGreaterThan(0.9);
    expect(share(tiers, (x) => x === 'high')).toBeGreaterThan(0.95);
    expect(tierProbes(tiers)).toBeLessThanOrEqual(4);
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

  it('meets a slow spell with one cut, not a cascade of them (#501)', () => {
    // 50 fps at full resolution, GPU-bound; every change reallocates the
    // post-process targets, which stalls a busy GPU: frames take twice as
    // long for 700 ms after it. Judged on the stall, each cut looks like it
    // failed and calls for another change.
    const run = (config: ScalerConfig) => {
      const c = { config, devicePixelRatio: 2 };
      let s = initialGovernor('high', config);
      let changes = 0;
      let cuts = 0;
      let sinceChange = Infinity;
      for (let t = 0; t < 30_000;) {
        const gpuMs = 20 * s.renderScale ** 2 * (sinceChange < 700 ? 2 : 1);
        const f = Math.max(1000 / 60, gpuMs);
        const next = stepGovernor(s, f, c);
        sinceChange += f;
        if (next.renderScale !== s.renderScale || next.tier !== s.tier) {
          changes++;
          if (next.renderScale < s.renderScale) cuts++;
          sinceChange = 0;
        }
        s = next;
        t += f;
      }
      return { changes, cuts, state: s };
    };
    const calm = run(config);
    expect(calm.cuts).toBe(1);
    expect(calm.changes).toBeLessThanOrEqual(2); // the cut, and perhaps one raise back
    expect(calm.state.tier).toBe('high');
    // With 5% steps and one settle window it read its own stalls as load.
    const before = run({ ...config, minCutStep: 0.05, settleWindows: 1 });
    expect(before.changes).toBeGreaterThanOrEqual(6);
  });

  it('after a failed tier probe, probes no tier for tierProbeCooldownMs (#501)', () => {
    // CPU-bound at 25 fps: neither pixels nor the tier are the cost. The
    // first cut probes a tier, which fails; the cap re-tests in the next two
    // minutes only re-check the resolution.
    const d = { cpuMs: 40, gpuMs: 8 };
    const first = simulate(start(), d, config.tierProbeCooldownMs - 5000);
    expect(tierProbes(first.tiers)).toBe(1);
    expect(first.state.tier).toBe('high');
    // Once the cooldown is over, one probe per cooldown at most.
    const { tiers } = simulate(start(), d, 5 * 60_000);
    expect(tierProbes(tiers)).toBeLessThanOrEqual(
      1 + Math.ceil((5 * 60_000) / config.tierProbeCooldownMs),
    );
  });

  it('cap re-tests at the floor change nothing within the cooldown (#501)', () => {
    // The owner's phone: on medium, at the floor, stalled at ~3 fps whatever
    // the tier. One probe to low, which fails and reverts; then the re-tests
    // only measure, with no resolution or tier change, until the cooldown ends.
    const floor = renderScaleFloor('medium', 2);
    const stalled = { cpuMs: 300, gpuMs: 8 };
    const s0 = { ...start('medium'), renderScale: floor };
    const { state, scales, tiers } = simulate(s0, stalled, config.tierProbeCooldownMs);
    expect(new Set(scales)).toEqual(new Set([floor]));
    const flips = tiers.filter((x, i) => i > 0 && x !== tiers[i - 1]).length;
    expect(flips).toBe(2); // the probe to low and its revert, nothing more
    expect(state.tier).toBe('medium');
    // On the cheapest tier there is nothing to probe: nothing ever changes.
    const low = simulate(
      { ...start('low'), renderScale: renderScaleFloor('low', 2) },
      stalled,
      600_000,
    );
    expect(new Set(low.scales).size).toBe(1);
    expect(new Set(low.tiers)).toEqual(new Set(['low']));
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
  /** The windows discarded after a change, at a frame time. */
  const settle = (s: GovernorState, frame: 12.5 | 20 | 25) => {
    expect(s.settleWindows).toBe(config.settleWindows);
    const st = windows(s, frame, config.settleWindows);
    expect(st.settleWindows).toBe(0);
    return st;
  };

  it('cuts in proportion to the shortfall, at least minCutStep, never below the floor', () => {
    // 50 fps wants ~0.913: one decisive cut to 0.9 instead (#501).
    expect(windows(ready(), 20, 1).renderScale).toBe(0.9);
    expect(windows(ready(), 25, 1).renderScale).toBeCloseTo(Math.sqrt(40 / 60), 2);
    expect(windows({ ...ready(), renderScale: 0.78 }, 25, 1).renderScale).toBe(0.75);
  });

  it('discards the window after a change, then judges the cut', () => {
    let s = windows(ready(), 20, 1); // cut, probe set
    s = settle(s, 20); // settle windows: no decision
    expect(s.probe).not.toBeNull();
    expect(s.renderScale).toBe(0.9);
    s = windows(s, 20, 1); // still 50 fps: the cut didn't help
    expect(s.renderScale).toBe(1);
    expect(s.cap?.fps).toBeCloseTo(50);
    // At or above tierProbeBelowFps it holds on its tier: no tier probe (#501).
    expect(s.tier).toBe('high');
    expect(s.tierProbe).toBeNull();
  });

  it('far below target, a cut that did not help probes a tier down, then reverts if that fails too (#501)', () => {
    let s = windows(ready(), 25, 1); // 40 fps: cut, probe set
    s = settle(s, 25);
    s = windows(s, 25, 1); // still 40 fps: pixels aren't the cost
    expect(s).toMatchObject({ tier: 'medium', renderScale: 1, probe: null, cap: null });
    expect(s.tierProbe).toEqual({ baselineFps: 40, tierBefore: 'high' });
    s = settle(s, 25);
    s = windows(s, 25, 1); // still 40 fps on medium: put the tier back and hold
    expect(s).toMatchObject({ tier: 'high', renderScale: 1, tierProbe: null });
    expect(s.cap?.fps).toBeCloseTo(40);
  });

  it('on the cheapest tier, a cut that did not help holds as before (#501)', () => {
    let s = windows(ready('low'), 25, 1);
    s = settle(s, 25);
    s = windows(s, 25, 1);
    expect(s).toMatchObject({ tier: 'low', renderScale: 1, tierProbe: null });
    expect(s.cap?.fps).toBeCloseTo(40);
  });

  it('backs off resolution raises that immediately cause a drop', () => {
    let s: GovernorState = { ...ready(), renderScale: 0.9 };
    s = windows(s, 12.5, 6); // 3 s of headroom → raise
    expect(s.renderScale).toBeCloseTo(0.95, 5);
    s = settle(s, 12.5);
    s = windows(s, 20, 1); // dropped right after the raise
    expect(s.raiseAfterMs).toBe(6000);
    // A cut right after a raise is no bigger than the shortfall asks for:
    // no whole minCutStep (0.85) below a size known to be close (#501).
    expect(s.renderScale).toBeCloseTo(0.95 * Math.sqrt(50 / 60), 3);
  });

  it('ignores long gaps such as a hidden tab', () => {
    const s0 = ready();
    const quality = ({ tier, renderScale }: GovernorState) => ({ tier, renderScale });
    expect(quality(stepGovernor(s0, 5000, ctx))).toEqual(quality(s0));
    expect(stepGovernor(s0, 0, ctx)).toBe(s0);
    expect(stepGovernor(s0, Number.NaN, ctx)).toBe(s0);
    // A pause now and then between normal frames is still a pause.
    let s = s0;
    for (let i = 0; i < 5; i++) {
      s = stepGovernor(s, 5000, ctx);
      s = windows(s, 12.5, 1);
    }
    expect(quality(s)).toEqual(quality(s0));
  });

  it('counts a run of slow frames short of crawling, so 2–3 fps steps down (#501)', () => {
    // 400 ms a frame at full resolution: every frame between maxFrameMs and
    // crawlFrameMs, as on the owner's iPhone. They used to be ignored as
    // pauses, so no window ever closed and quality never moved.
    for (const gpuMs of [400, 500, 900]) {
      const before = 1000 / frameMs(start(), { gpuMs });
      const { state, fps } = simulate(start(), { gpuMs }, 120_000);
      expect(state.tier, `${String(gpuMs)} ms`).toBe('low');
      expect(state.renderScale, `${String(gpuMs)} ms`).toBeLessThan(1);
      expect(fps, `${String(gpuMs)} ms`).toBeGreaterThan(before * 2);
      expect(state.crawlFrames).toBe(0); // the normal path, not a crawl to low
    }
    // A CPU-bound phone this slow holds: lower quality wouldn't help it.
    const { state } = simulate(start(), { cpuMs: 400, gpuMs: 8 }, 120_000);
    expect(state).toMatchObject({ tier: 'high', renderScale: 1 });
  });

  it('one or two slow frames (a shader compile) among fast ones change nothing (#501)', () => {
    const s0 = windows(ready(), 12.5, 4);
    const quality = ({ tier, renderScale }: GovernorState) => ({ tier, renderScale });
    let s = s0;
    for (let hitch = 0; hitch < 5; hitch++) {
      for (let i = 1; i < config.crawlFrames; i++) s = stepGovernor(s, 400, ctx);
      s = windows(s, 12.5, 2);
    }
    expect(quality(s)).toEqual(quality(s0));
    expect(s.slowRun).toBe(0);
    // A resume ends a run too, as it does a crawl.
    s = stepGovernor(s, 400, ctx);
    expect(resumeGovernor(s).slowRun).toBe(0);
  });

  it('treats one huge gap followed by normal frames as a pause: no step-down', () => {
    // A tab hidden for a minute, an app switch, a device asleep: the frame
    // that spans it is long, and the frames after it are fine.
    let s = ready();
    s = stepGovernor(s, 60_000, ctx);
    s = windows(s, 12.5, 4);
    expect(s.tier).toBe('high');
    expect(s.renderScale).toBe(1);
    expect(s.crawlFrames).toBe(0);
  });

  it('a shorter frame between crawling frames ends the run: they must be consecutive', () => {
    let s = start();
    s = stepGovernor(s, 2000, ctx);
    s = stepGovernor(s, 500, ctx); // long, but not a crawling frame
    s = stepGovernor(s, 2000, ctx);
    s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('high');
    s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('low');
  });

  it('crawl forgets a probe and a cap, so nothing puts the pixels back later', () => {
    // Mid-probe (a cut being judged) and holding at a cap: a crawl is a
    // different world; the raises decide what comes back.
    const probing: GovernorState = {
      ...ready(),
      renderScale: 0.9,
      probe: { baselineFps: 40, scaleBefore: 0.95 },
      cap: { fps: 30, heldMs: 0, holdMs: 20_000 },
    };
    let s = probing;
    for (let i = 0; i < config.crawlFrames; i++) s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('low');
    expect(s.renderScale).toBe(0.5);
    expect(s.probe).toBeNull();
    expect(s.cap).toBeNull();
    expect(s.settleWindows).toBe(config.settleWindows);
    // The first window after the change is judged on nothing it inherited.
    s = windows(s, 12.5, 2);
    expect(s.renderScale).toBe(0.5);
  });

  it('a resume (visibilitychange, pageshow) ends a run of crawling frames', () => {
    // Two long frames, a pause, two more: around a pause they never add up.
    let s = start();
    s = stepGovernor(s, 2000, ctx);
    s = stepGovernor(s, 2000, ctx);
    expect(s.crawlFrames).toBe(2);
    s = resumeGovernor(s);
    expect(s.crawlFrames).toBe(0);
    expect(resumeGovernor(s)).toBe(s);
    s = stepGovernor(s, 2000, ctx);
    s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('high');
    s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('low');
  });

  it('goes to the cheapest tier at one pixel per CSS pixel when every frame crawls', () => {
    // A software renderer, or a very weak GPU: nothing above would ever fire,
    // each frame is too long to count, so no window closes. Three in a row is
    // the renderer, not a pause.
    let s = start();
    for (let i = 0; i < config.crawlFrames - 1; i++) s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('high');
    expect(s.renderScale).toBe(1);
    s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('low');
    expect(s.renderScale).toBe(0.5); // one render pixel per CSS pixel on a 2x screen
    // At the bottom it stays there, quietly.
    for (let i = 0; i < config.crawlFrames; i++) s = stepGovernor(s, 2000, ctx);
    expect(s.tier).toBe('low');
    expect(s.renderScale).toBe(0.5);
    // A 1x screen is never scaled, as ever.
    const one = stepGovernor({ ...start(), crawlFrames: config.crawlFrames - 1 }, 2000, {
      ...ctx,
      devicePixelRatio: 1,
    });
    expect(one.tier).toBe('low');
    expect(one.renderScale).toBe(1);
    // Back at speed, the usual raises apply: full resolution first, then the tier.
    const { state } = simulate(s, { gpuMs: 2 }, 120_000);
    expect(state.renderScale).toBe(1);
    expect(state.tier).toBe('high');
  });
});

describe('cappedScaler (#501)', () => {
  it('scales every frame-rate threshold to a 30 fps cap and nothing else', () => {
    const capped = cappedScaler(SCALER, 30);
    expect(capped).toMatchObject({
      targetFps: 30,
      lowerBelowFps: SCALER.lowerBelowFps / 2,
      raiseAtFps: SCALER.raiseAtFps / 2,
      tierProbeBelowFps: SCALER.tierProbeBelowFps / 2,
      tierDropBelowFps: SCALER.tierDropBelowFps / 2,
      windowMs: SCALER.windowMs,
      maxFrameMs: SCALER.maxFrameMs,
      cutGain: SCALER.cutGain,
    });
  });
});
