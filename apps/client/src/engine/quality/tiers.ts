import {
  DEFAULT_QUALITY_TIER,
  MIN_EFFECTIVE_PIXEL_RATIO,
  PHONE_MAX_SHORT_SIDE,
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

/**
 * True on a phone's screen (`PHONE_MAX_SHORT_SIDE`). The screen, not the
 * window, so turning the phone or a split-screen iPad never flips it. False
 * with no screen to read (unit tests).
 */
export function isPhoneScreen(screen: Pick<Screen, 'width' | 'height'> | undefined): boolean {
  if (!screen || !(screen.width > 0) || !(screen.height > 0)) return false;
  return Math.min(screen.width, screen.height) < PHONE_MAX_SHORT_SIDE;
}

/** Whether `tier` draws bloom on this device (`TierSettings.phoneBloom`, #501). */
export function tierBloom(tier: QualityTier, phone: boolean): boolean {
  const t = TIER_SETTINGS[tier];
  return t.bloom && (!phone || t.phoneBloom);
}

/** The next cheaper tier, or null when already on the cheapest. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return QUALITY_TIERS[QUALITY_TIERS.indexOf(tier) + 1] ?? null;
}

/** The next better tier, never above `ceiling`; null when already there. */
export function higherTier(tier: QualityTier, ceiling: QualityTier): QualityTier | null {
  const i = QUALITY_TIERS.indexOf(tier);
  return i > QUALITY_TIERS.indexOf(ceiling) ? (QUALITY_TIERS[i - 1] ?? null) : null;
}

/**
 * The render scale for a crawling renderer (governor `crawl`): one render
 * pixel per CSS pixel, the sharpness bound the tier floors also respect, with
 * the tiers' own extra margin given up. Never above 1.
 */
export function crawlRenderScale(devicePixelRatio: number): number {
  return Math.min(1, MIN_EFFECTIVE_PIXEL_RATIO / cappedPixelRatio(devicePixelRatio));
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
