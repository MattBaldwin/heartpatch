import type { QualityTier, ScalerConfig } from '../config.js';
import { crawlRenderScale, higherTier, lowerTier, renderScaleFloor } from './tiers.js';

/**
 * Dynamic resolution and quality-tier governor, as a pure reducer over frame
 * times so it can be tested without a GPU.
 *
 * Every `windowMs` it looks at the average frame rate:
 * - **Too slow:** lower the render scale straight away, by roughly the amount
 *   the frame rate is short (GPU cost scales with pixel count, i.e. scale²),
 *   never below the tier's floor. That keeps 60 fps instead of letting it
 *   collapse, without ever going blurry.
 * - **Every cut and tier drop is a probe.** If the next window isn't faster,
 *   the GPU isn't (or is no longer) the bottleneck: the frame rate is capped
 *   (iOS Low Power Mode runs Safari at 30 fps) or the CPU is busy. Lowering
 *   quality further would only cost sharpness, so undo that step and hold at
 *   that frame rate until it changes. The hold is re-tested now and then, less
 *   often each time the cap is confirmed.
 * - **Pinned at the floor and still well below target** for a while, with the
 *   last cut having helped: step the quality tier down (softer bloom, then none).
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
  /** Set by a resolution cut; the next window tells whether that cut helped. */
  readonly probe: { readonly baselineFps: number; readonly scaleBefore: number } | null;
  /** Set by a tier drop; the next window tells whether the drop helped. */
  readonly tierProbe: { readonly baselineFps: number; readonly tierBefore: QualityTier } | null;
  /** Holding at a frame rate that lower quality can't fix. */
  readonly cap: { readonly fps: number; readonly heldMs: number; readonly holdMs: number } | null;
  /** How long the next cap hold lasts before a re-test; doubles each time one is confirmed. */
  readonly capHoldMs: number;
  /** Continuous time stuck at the floor and still too slow. */
  readonly slowAtFloorMs: number;
  /** Continuous time at target at full resolution (tier raises). */
  readonly tierGoodMs: number;
  readonly tierRaiseAfterMs: number;
  readonly sinceTierRaiseMs: number | null;
  /** Consecutive frames longer than `crawlFrameMs` so far (see `crawl`). */
  readonly crawlFrames: number;
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
    tierProbe: null,
    cap: null,
    capHoldMs: config.capHoldMs,
    slowAtFloorMs: 0,
    tierGoodMs: 0,
    tierRaiseAfterMs: config.tierRaiseAfterMs,
    sinceTierRaiseMs: null,
    crawlFrames: 0,
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
  if (!(frameMs > 0)) return state;
  if (frameMs > config.maxFrameMs) {
    // A pause (hidden tab, debugger, one shader compile) says nothing about
    // the frame rate; a run of them says the renderer is crawling.
    return frameMs > config.crawlFrameMs ? crawl(state, ctx) : state;
  }
  if (state.crawlFrames > 0) state = { ...state, crawlFrames: 0 };

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

/** Undo a step that didn't help and hold at this frame rate. */
/**
 * The page paused (a hidden tab, an iOS app switch, a device asleep and
 * back): the frame that spans it is a gap, never a crawling frame, however
 * many gaps come around one pause. Called on `visibilitychange` and
 * `pageshow`; a normal frame ends a run as well.
 */
export function resumeGovernor(state: GovernorState): GovernorState {
  return state.crawlFrames === 0 ? state : { ...state, crawlFrames: 0 };
}

/**
 * Another frame longer than `crawlFrameMs`. Once `crawlFrames` of them come in
 * a row the renderer is crawling (a very weak GPU, software WebGL in CI):
 * every frame is "too long to count", so the windows above never close and
 * nothing would ever change. Go straight to the cheapest tier at one render
 * pixel per CSS pixel (a tier at a time would mean a shader rebuild, and more
 * crawling frames, per step); the usual raises bring quality back if the
 * slowness passes.
 */
function crawl(s: GovernorState, ctx: GovernorContext): GovernorState {
  const { config, devicePixelRatio } = ctx;
  const crawlFrames = s.crawlFrames + 1;
  if (crawlFrames < config.crawlFrames) return { ...s, crawlFrames };
  let tier = s.tier;
  for (let cheaper = lowerTier(tier); cheaper !== null; cheaper = lowerTier(cheaper)) {
    tier = cheaper;
  }
  const renderScale = roundScale(crawlRenderScale(devicePixelRatio));
  if (tier === s.tier && renderScale === s.renderScale) return { ...s, crawlFrames: 0 };
  return {
    ...s,
    tier,
    renderScale,
    crawlFrames: 0,
    settleWindows: 1,
    probe: null,
    tierProbe: null,
    cap: null,
    goodMs: 0,
    tierGoodMs: 0,
    slowAtFloorMs: 0,
    sinceRaiseMs: null,
    sinceTierRaiseMs: null,
  };
}

function holdAtCap(
  s: GovernorState,
  fps: number,
  undo: { renderScale: number; tier: QualityTier },
  config: ScalerConfig,
): GovernorState {
  const changed = undo.renderScale !== s.renderScale || undo.tier !== s.tier;
  return {
    ...s,
    ...undo,
    settleWindows: changed ? 1 : 0,
    probe: null,
    tierProbe: null,
    cap: { fps, heldMs: 0, holdMs: s.capHoldMs },
    capHoldMs: Math.min(s.capHoldMs * 2, config.maxCapHoldMs),
    slowAtFloorMs: 0,
    goodMs: 0,
    tierGoodMs: 0,
  };
}

function decide(s: GovernorState, fps: number, w: number, ctx: GovernorContext): GovernorState {
  const { config, devicePixelRatio } = ctx;
  if (s.cap) {
    const heldMs = s.cap.heldMs + w;
    if (fps >= config.raiseAtFps) {
      s = { ...s, cap: null, capHoldMs: config.capHoldMs }; // the cap really lifted
    } else if (fps < s.cap.fps * (1 - config.capTolerance) || heldMs >= s.cap.holdMs) {
      s = { ...s, cap: null }; // new load, or time to re-test
    } else {
      return { ...s, cap: { ...s.cap, heldMs }, goodMs: 0, tierGoodMs: 0 };
    }
  }

  if (s.tierProbe) {
    const { baselineFps, tierBefore } = s.tierProbe;
    if (fps < config.lowerBelowFps && fps < baselineFps * config.cutGain) {
      const renderScale = roundScale(
        Math.max(renderScaleFloor(tierBefore, devicePixelRatio), s.renderScale),
      );
      return holdAtCap(s, Math.max(fps, baselineFps), { renderScale, tier: tierBefore }, config);
    }
    s = { ...s, tierProbe: null };
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
  if (s.probe && fps < s.probe.baselineFps * config.cutGain) {
    // That cut didn't help: capped or CPU-bound. Put the pixels back and hold.
    return holdAtCap(
      s,
      Math.max(fps, s.probe.baselineFps),
      { renderScale: s.probe.scaleBefore, tier: s.tier },
      config,
    );
  }

  const floor = renderScaleFloor(s.tier, devicePixelRatio);
  const base = { ...s, probe: null, goodMs: 0, tierGoodMs: 0 };

  if (s.renderScale > floor) {
    const wanted = s.renderScale * Math.sqrt(fps / config.targetFps);
    const renderScale = roundScale(Math.max(floor, Math.min(wanted, s.renderScale - config.step)));
    const flapped = s.sinceRaiseMs !== null && s.sinceRaiseMs <= config.flapWindowMs;
    return {
      ...base,
      renderScale,
      settleWindows: 1,
      probe: { baselineFps: fps, scaleBefore: s.renderScale },
      slowAtFloorMs: 0,
      sinceRaiseMs: null,
      raiseAfterMs: flapped ? Math.min(s.raiseAfterMs * 2, config.maxRaiseAfterMs) : s.raiseAfterMs,
    };
  }

  // At the floor, and the last cut (if any) helped.
  if (fps >= config.tierDropBelowFps) return { ...base, slowAtFloorMs: 0 };
  const slowAtFloorMs = s.slowAtFloorMs + w;
  const cheaper = lowerTier(s.tier);
  if (slowAtFloorMs < config.tierDropAfterMs || cheaper === null) {
    return { ...base, slowAtFloorMs };
  }
  const flapped = s.sinceTierRaiseMs !== null && s.sinceTierRaiseMs <= config.tierFlapWindowMs;
  return {
    ...base,
    tier: cheaper,
    renderScale: roundScale(Math.max(renderScaleFloor(cheaper, devicePixelRatio), s.renderScale)),
    settleWindows: 1,
    tierProbe: { baselineFps: fps, tierBefore: s.tier },
    slowAtFloorMs: 0,
    sinceTierRaiseMs: null,
    tierRaiseAfterMs: flapped
      ? Math.min(s.tierRaiseAfterMs * 2, config.maxTierRaiseAfterMs)
      : s.tierRaiseAfterMs,
  };
}

function good(s: GovernorState, w: number, config: ScalerConfig): GovernorState {
  const base = { ...s, probe: null, slowAtFloorMs: 0 };

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
