import type { QualityTier, ScalerConfig } from '../config.js';
import { higherTier, lowerTier, renderScaleFloor } from './tiers.js';

/**
 * Dynamic resolution and quality-tier governor, as a pure reducer over frame
 * times so it can be tested without a GPU.
 *
 * Every `windowMs` it looks at the average frame rate:
 * - **Too slow:** lower the render scale straight away, by roughly the amount
 *   the frame rate is short (GPU cost scales with pixel count, i.e. scale²),
 *   never below the tier's floor. That keeps 60 fps instead of letting it
 *   collapse, without ever going blurry.
 * - **Did the cut help?** If the next window isn't faster, the GPU isn't the
 *   bottleneck: the frame rate is capped (iOS Low Power Mode runs Safari at
 *   30 fps) or the CPU is busy. Lower resolution would only cost sharpness,
 *   so restore it and hold at that frame rate until it changes.
 * - **Proven GPU-bound, pinned at the floor and still well below target** for
 *   a while: step the quality tier down (drop MSAA, then bloom).
 * - **At target for a while:** raise resolution a step at a time, then the
 *   tier, never above the tier the player started on. Vsync caps the reading
 *   at 60 fps, so headroom is invisible; if a raise makes us drop again
 *   straight away, wait twice as long before the next try.
 *
 * The first `graceMs` are ignored (shader compiles), and so is the first
 * window after any change (resizing render targets causes a hitch).
 */
export interface GovernorState {
  readonly tier: QualityTier;
  /** The tier the player started on; recovery never goes above it. */
  readonly ceiling: QualityTier;
  /** Fraction of the DPR-capped resolution we render at, in [floor, 1]. */
  readonly renderScale: number;
  readonly elapsedMs: number;
  readonly windowMs: number;
  readonly windowFrames: number;
  /** Windows still to discard after the last change. */
  readonly settleWindows: number;
  /** Continuous time at target frame rate (resolution raises). */
  readonly goodMs: number;
  readonly raiseAfterMs: number;
  /** Time since the last resolution raise, or null if the last change wasn't one. */
  readonly sinceRaiseMs: number | null;
  /** Set by a resolution cut; the next window tells whether the cut helped. */
  readonly probe: { readonly baselineFps: number; readonly scaleBefore: number } | null;
  /** A cut has measurably raised the frame rate in this slow spell. */
  readonly gpuBound: boolean;
  /** Holding at a frame rate that resolution can't fix. */
  readonly cap: { readonly fps: number; readonly heldMs: number } | null;
  /** Continuous time stuck at the floor and still too slow. */
  readonly slowAtFloorMs: number;
  /** Continuous time at target at full resolution (tier raises). */
  readonly tierGoodMs: number;
  readonly tierRaiseAfterMs: number;
  readonly sinceTierRaiseMs: number | null;
}

export interface GovernorContext {
  readonly config: ScalerConfig;
  readonly devicePixelRatio: number;
}

export function initialGovernor(tier: QualityTier, config: ScalerConfig): GovernorState {
  return {
    tier,
    ceiling: tier,
    renderScale: 1,
    elapsedMs: 0,
    windowMs: 0,
    windowFrames: 0,
    settleWindows: 0,
    goodMs: 0,
    raiseAfterMs: config.raiseAfterMs,
    sinceRaiseMs: null,
    probe: null,
    gpuBound: false,
    cap: null,
    slowAtFloorMs: 0,
    tierGoodMs: 0,
    tierRaiseAfterMs: config.tierRaiseAfterMs,
    sinceTierRaiseMs: null,
  };
}

/** Rounded so repeated steps don't accumulate float noise (0.7500000001). */
function roundScale(scale: number): number {
  return Math.round(scale * 1000) / 1000;
}

const plus = (t: number | null, ms: number): number | null => (t === null ? null : t + ms);

export function stepGovernor(
  state: GovernorState,
  frameMs: number,
  ctx: GovernorContext,
): GovernorState {
  const { config } = ctx;
  if (!(frameMs > 0) || frameMs > config.maxFrameMs) return state;

  const elapsedMs = state.elapsedMs + frameMs;
  if (elapsedMs < config.graceMs) return { ...state, elapsedMs };

  const windowMs = state.windowMs + frameMs;
  const windowFrames = state.windowFrames + 1;
  const next = {
    ...state,
    elapsedMs,
    sinceRaiseMs: plus(state.sinceRaiseMs, frameMs),
    sinceTierRaiseMs: plus(state.sinceTierRaiseMs, frameMs),
  };
  if (windowMs < config.windowMs) return { ...next, windowMs, windowFrames };

  const closed = { ...next, windowMs: 0, windowFrames: 0 };
  if (state.settleWindows > 0) return { ...closed, settleWindows: state.settleWindows - 1 };
  return decide(closed, (windowFrames * 1000) / windowMs, windowMs, ctx);
}

function decide(s: GovernorState, fps: number, w: number, ctx: GovernorContext): GovernorState {
  const { config } = ctx;
  if (s.cap) {
    const heldMs = s.cap.heldMs + w;
    const lifted = fps >= config.raiseAtFps;
    const newLoad = fps < s.cap.fps * (1 - config.capTolerance);
    if (!lifted && !newLoad && heldMs < config.capHoldMs) {
      return { ...s, cap: { fps: s.cap.fps, heldMs }, goodMs: 0, tierGoodMs: 0 };
    }
    s = { ...s, cap: null };
  }

  if (fps < config.lowerBelowFps) return slow(s, fps, w, ctx);

  if (fps < config.raiseAtFps) {
    // Close enough: stop cutting, but this isn't headroom either.
    return { ...s, probe: null, goodMs: 0, tierGoodMs: 0, slowAtFloorMs: 0 };
  }
  return good(s, w, config);
}

function slow(s: GovernorState, fps: number, w: number, ctx: GovernorContext): GovernorState {
  const { config, devicePixelRatio } = ctx;
  const floor = renderScaleFloor(s.tier, devicePixelRatio);
  const base = { ...s, goodMs: 0, tierGoodMs: 0 };

  let gpuBound = s.gpuBound;
  if (s.probe) {
    if (fps >= s.probe.baselineFps * config.cutGain) {
      gpuBound = true;
    } else if (!gpuBound) {
      // The cut didn't help: capped or CPU-bound. Put the pixels back and hold.
      return {
        ...base,
        renderScale: s.probe.scaleBefore,
        settleWindows: s.probe.scaleBefore === s.renderScale ? 0 : 1,
        probe: null,
        cap: { fps: Math.max(fps, s.probe.baselineFps), heldMs: 0 },
        slowAtFloorMs: 0,
      };
    }
  }

  if (s.renderScale > floor) {
    const wanted = s.renderScale * Math.sqrt(fps / config.targetFps);
    const renderScale = roundScale(Math.max(floor, Math.min(wanted, s.renderScale - config.step)));
    const flapped = s.sinceRaiseMs !== null && s.sinceRaiseMs <= config.flapWindowMs;
    return {
      ...base,
      renderScale,
      settleWindows: 1,
      probe: { baselineFps: fps, scaleBefore: s.probe?.scaleBefore ?? s.renderScale },
      gpuBound,
      slowAtFloorMs: 0,
      sinceRaiseMs: null,
      raiseAfterMs: flapped ? Math.min(s.raiseAfterMs * 2, config.maxRaiseAfterMs) : s.raiseAfterMs,
    };
  }

  // At the floor. Only drop a tier when resolution demonstrably mattered, or
  // when there's no resolution to probe with (a 1x screen has floor 1).
  const proven = gpuBound || floor >= 1;
  if (!proven || fps >= config.tierDropBelowFps) {
    return { ...base, probe: null, gpuBound, slowAtFloorMs: 0 };
  }
  const slowAtFloorMs = s.slowAtFloorMs + w;
  const cheaper = lowerTier(s.tier);
  if (slowAtFloorMs < config.tierDropAfterMs || cheaper === null) {
    return { ...base, probe: null, gpuBound, slowAtFloorMs };
  }
  const flapped = s.sinceTierRaiseMs !== null && s.sinceTierRaiseMs <= config.tierFlapWindowMs;
  return {
    ...base,
    tier: cheaper,
    renderScale: roundScale(Math.max(renderScaleFloor(cheaper, devicePixelRatio), s.renderScale)),
    settleWindows: 1,
    probe: null,
    gpuBound,
    slowAtFloorMs: 0,
    sinceTierRaiseMs: null,
    tierRaiseAfterMs: flapped
      ? Math.min(s.tierRaiseAfterMs * 2, config.maxTierRaiseAfterMs)
      : s.tierRaiseAfterMs,
  };
}

function good(s: GovernorState, w: number, config: ScalerConfig): GovernorState {
  const base = { ...s, probe: null, gpuBound: false, slowAtFloorMs: 0 };

  if (s.renderScale < 1) {
    const goodMs = s.goodMs + w;
    if (goodMs < s.raiseAfterMs) return { ...base, goodMs, tierGoodMs: 0 };
    return {
      ...base,
      renderScale: roundScale(Math.min(1, s.renderScale + config.step)),
      settleWindows: 1,
      goodMs: 0,
      tierGoodMs: 0,
      sinceRaiseMs: 0,
    };
  }

  const tierGoodMs = s.tierGoodMs + w;
  const better = higherTier(s.tier, s.ceiling);
  if (better === null || tierGoodMs < s.tierRaiseAfterMs) {
    return { ...base, goodMs: 0, tierGoodMs };
  }
  return {
    ...base,
    tier: better,
    settleWindows: 1,
    goodMs: 0,
    tierGoodMs: 0,
    sinceTierRaiseMs: 0,
  };
}
