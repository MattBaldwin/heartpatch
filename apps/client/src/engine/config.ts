/**
 * Render-quality, lighting and camera tunables in one place. Every number
 * here is a first guess to be checked on the playtest devices (iPhone 14+,
 * recent iPads); see docs/DECISIONS.md "Devices and playtesting".
 */

export type QualityTier = 'high' | 'medium' | 'low';

/** Ordered best to cheapest; the governor only ever steps down this list. */
export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

/** Tier used when the player hasn't picked one (tech spec §6). */
export const DEFAULT_QUALITY_TIER: QualityTier = 'high';

export interface TierSettings {
  /** MSAA samples on the post-process chain (1 = off). FXAA runs on every tier. */
  msaaSamples: number;
  bloom: boolean;
  /** Bloom blur kernel in render pixels; bigger is softer and costlier. */
  bloomKernel: number;
  /**
   * Lowest fraction of the DPR-capped resolution the dynamic scaler may use.
   * On a 2x screen 0.75 means 1.5 render pixels per CSS pixel: softer, never
   * pixelated.
   */
  minRenderScale: number;
}

export const TIER_SETTINGS: Readonly<Record<QualityTier, TierSettings>> = {
  // TUNE: high is the default on playtest devices; spend headroom here first.
  high: { msaaSamples: 4, bloom: true, bloomKernel: 64, minRenderScale: 0.75 },
  // TUNE
  medium: { msaaSamples: 1, bloom: true, bloomKernel: 32, minRenderScale: 0.75 },
  // TUNE
  low: { msaaSamples: 1, bloom: false, bloomKernel: 0, minRenderScale: 0.7 },
};

/**
 * Never render below one pixel per CSS pixel, whatever the tier floor says:
 * below that the image upsamples and looks blurry.
 */
export const MIN_EFFECTIVE_PIXEL_RATIO = 1;

export interface ScalerConfig {
  targetFps: number;
  /** Frames are averaged over windows this long before any decision. */
  windowMs: number;
  /** Lower resolution when a window averages below this. */
  lowerBelowFps: number;
  /** A window at or above this counts towards raising resolution again. */
  raiseAtFps: number;
  /** Smallest change in render scale per decision. */
  step: number;
  /** Continuous good time needed before trying a higher resolution. */
  raiseAfterMs: number;
  /** Cap for the raise delay after repeated raise-then-drop flapping. */
  maxRaiseAfterMs: number;
  /** A drop within this long after a raise counts as flapping. */
  flapWindowMs: number;
  /** Frame gaps longer than this (tab hidden, debugger) are ignored. */
  maxFrameMs: number;
  /** Step a tier down after this long pinned at the floor and still slow. */
  tierDropAfterMs: number;
  /** "Still slow" for the tier governor. */
  tierDropBelowFps: number;
}

export const SCALER: Readonly<ScalerConfig> = {
  targetFps: 60,
  windowMs: 500, // TUNE
  lowerBelowFps: 55, // TUNE: react before the frame rate collapses
  raiseAtFps: 58, // TUNE: vsync caps at 60, so near-60 is "has headroom"
  step: 0.05, // TUNE
  raiseAfterMs: 3000, // TUNE
  maxRaiseAfterMs: 30_000, // TUNE
  flapWindowMs: 2000, // TUNE
  maxFrameMs: 250, // TUNE
  tierDropAfterMs: 3000, // TUNE
  tierDropBelowFps: 50, // TUNE
};

export const LIGHTING = {
  /** Edge length of each procedural sky cube face, in texels. */
  envSize: 64, // TUNE
  environmentIntensity: 0.9, // TUNE
  /** Warm key light from the upper left, like a late-afternoon window. */
  sunDirection: { x: -0.45, y: -1, z: 0.6 }, // TUNE
  sunIntensity: 1.6, // TUNE
  exposure: 1.05, // TUNE
  contrast: 1.05, // TUNE
  /** Only the brightest highlights glow, so bloom stays gentle. */
  bloomThreshold: 0.85, // TUNE
  bloomWeight: 0.25, // TUNE
  bloomScale: 0.5, // TUNE: bloom renders at half resolution
} as const;

export interface CameraConfig {
  /** Field of view (vertical), radians. */
  fov: number;
  /** Tilt down from the horizon, radians (π/2 is straight down). */
  pitch: number;
  /** Heading, radians; 0 looks towards +z. */
  yaw: number;
  minDistance: number;
  maxDistance: number;
  startDistance: number;
  /** Inertia half-life feel: velocity decays by e every `inertiaTimeConstant` s. */
  inertiaTimeConstant: number;
  /** Release velocity (world units/s, per unit of zoom distance) below which we just stop. */
  minFlingSpeed: number;
  /** Fastest fling (per unit of zoom distance), so a wild flick can't fly off the map. */
  maxFlingSpeed: number;
  /** Only pointer samples this recent count towards the release velocity. */
  velocitySampleMs: number;
  /** Mouse-wheel zoom: distance multiplier per 100 px of wheel delta. */
  wheelZoomPer100Px: number;
}

export const CAMERA: Readonly<CameraConfig> = {
  fov: 0.75, // TUNE
  pitch: (58 * Math.PI) / 180, // TUNE: top-down with a slight tilt (design §20)
  yaw: 0,
  minDistance: 7, // TUNE
  maxDistance: 38, // TUNE
  startDistance: 20, // TUNE
  inertiaTimeConstant: 0.32, // TUNE
  minFlingSpeed: 0.15, // TUNE
  maxFlingSpeed: 4, // TUNE
  velocitySampleMs: 100, // TUNE
  wheelZoomPer100Px: 1.15, // TUNE
};
