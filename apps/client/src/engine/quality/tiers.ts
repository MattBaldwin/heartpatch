import {
  DEFAULT_QUALITY_TIER,
  MIN_EFFECTIVE_PIXEL_RATIO,
  QUALITY_TIERS,
  TIER_SETTINGS,
  type QualityTier,
} from '../config.js';
import { cappedPixelRatio } from '../dpr.js';

export function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === 'string' && (QUALITY_TIERS as readonly string[]).includes(value);
}

/**
 * The tier to start on: the player's choice if it's a real tier (settings
 * arrive later; `?quality=` works now for testing), otherwise the default.
 * The governor then steps down at runtime if the device can't keep up.
 */
export function pickInitialTier(...overrides: (string | null | undefined)[]): QualityTier {
  return overrides.find(isQualityTier) ?? DEFAULT_QUALITY_TIER;
}

/** The next cheaper tier, or null when already on the cheapest. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return QUALITY_TIERS[QUALITY_TIERS.indexOf(tier) + 1] ?? null;
}

/**
 * Lowest render scale (fraction of the DPR-capped resolution) for a tier on a
 * screen. Never below one render pixel per CSS pixel, so a 1x desktop screen
 * is never scaled at all.
 */
export function renderScaleFloor(tier: QualityTier, devicePixelRatio: number): number {
  const base = cappedPixelRatio(devicePixelRatio);
  return Math.min(
    1,
    Math.max(TIER_SETTINGS[tier].minRenderScale, MIN_EFFECTIVE_PIXEL_RATIO / base),
  );
}
