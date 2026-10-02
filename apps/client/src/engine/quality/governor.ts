import type { QualityTier, ScalerConfig } from '../config.js';
import { lowerTier, renderScaleFloor } from './tiers.js';

/**
 * Dynamic resolution and quality-tier governor, as a pure reducer over frame
 * times so it can be tested without a GPU.
 *
 * Every `windowMs` it looks at the average frame rate:
 * - **Too slow:** lower the render scale straight away, by roughly the amount
 *   the frame rate is short (GPU cost scales with pixel count, i.e. scale²),
 *   but never below the tier's floor. That keeps 60 fps instead of letting it
 *   collapse, without ever going blurry.
 * - **Pinned at the floor and still well below target** for a while: step the
 *   quality tier down (drop MSAA, then bloom).
 * - **At target for a while:** try one step more resolution. Vsync caps the
 *   measurement at 60 fps, so we can't see headroom directly; if the raise
 *   makes us drop again straight away, wait twice as long before the next try.
 */
export interface GovernorState {
  readonly tier: QualityTier;
  /** Fraction of the DPR-capped resolution we render at, in [floor, 1]. */
  readonly renderScale: number;
  readonly windowMs: number;
  readonly windowFrames: number;
  /** Continuous time at target frame rate. */
  readonly goodMs: number;
  /** Current delay before trying a higher resolution (grows on flapping). */
  readonly raiseAfterMs: number;
  /** Time since the last raise, or null if the last change wasn't a raise. */
  readonly sinceRaiseMs: number | null;
  /** Continuous time stuck at the floor and still too slow. */
  readonly slowAtFloorMs: number;
}

export interface GovernorContext {
  readonly config: ScalerConfig;
  readonly devicePixelRatio: number;
}

export function initialGovernor(tier: QualityTier, config: ScalerConfig): GovernorState {
  return {
    tier,
    renderScale: 1,
    windowMs: 0,
    windowFrames: 0,
    goodMs: 0,
    raiseAfterMs: config.raiseAfterMs,
    sinceRaiseMs: null,
    slowAtFloorMs: 0,
  };
}

/** Rounded so repeated steps don't accumulate float noise (0.7500000001). */
function roundScale(scale: number): number {
  return Math.round(scale * 1000) / 1000;
}

export function stepGovernor(
  state: GovernorState,
  frameMs: number,
  { config, devicePixelRatio }: GovernorContext,
): GovernorState {
  if (!(frameMs > 0) || frameMs > config.maxFrameMs) return state;

  const windowMs = state.windowMs + frameMs;
  const windowFrames = state.windowFrames + 1;
  const sinceRaiseMs = state.sinceRaiseMs === null ? null : state.sinceRaiseMs + frameMs;
  if (windowMs < config.windowMs) {
    return { ...state, windowMs, windowFrames, sinceRaiseMs };
  }

  const fps = (windowFrames * 1000) / windowMs;
  const next = { ...state, windowMs: 0, windowFrames: 0, sinceRaiseMs };
  const floor = renderScaleFloor(state.tier, devicePixelRatio);

  if (fps < config.lowerBelowFps) {
    if (state.renderScale > floor) {
      const wanted = state.renderScale * Math.sqrt(fps / config.targetFps);
      const renderScale = roundScale(
        Math.max(floor, Math.min(wanted, state.renderScale - config.step)),
      );
      const flapped = sinceRaiseMs !== null && sinceRaiseMs <= config.flapWindowMs;
      return {
        ...next,
        renderScale,
        goodMs: 0,
        slowAtFloorMs: 0,
        sinceRaiseMs: null,
        raiseAfterMs: flapped
          ? Math.min(state.raiseAfterMs * 2, config.maxRaiseAfterMs)
          : state.raiseAfterMs,
      };
    }

    if (fps >= config.tierDropBelowFps) return { ...next, goodMs: 0, slowAtFloorMs: 0 };

    const slowAtFloorMs = state.slowAtFloorMs + windowMs;
    const cheaper = lowerTier(state.tier);
    if (slowAtFloorMs < config.tierDropAfterMs || cheaper === null) {
      return { ...next, goodMs: 0, slowAtFloorMs };
    }
    const cheaperFloor = renderScaleFloor(cheaper, devicePixelRatio);
    return {
      ...next,
      tier: cheaper,
      renderScale: roundScale(Math.max(cheaperFloor, state.renderScale)),
      goodMs: 0,
      slowAtFloorMs: 0,
    };
  }

  if (fps < config.raiseAtFps) return { ...next, goodMs: 0, slowAtFloorMs: 0 };

  const goodMs = state.goodMs + windowMs;
  if (goodMs < state.raiseAfterMs || state.renderScale >= 1) {
    return { ...next, goodMs, slowAtFloorMs: 0 };
  }
  return {
    ...next,
    renderScale: roundScale(Math.min(1, state.renderScale + config.step)),
    goodMs: 0,
    slowAtFloorMs: 0,
    sinceRaiseMs: 0,
  };
}
