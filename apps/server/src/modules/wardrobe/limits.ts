// Rate limits for the wardrobe (tech spec §5). Trying things on happens on
// the device; the client sends the outfit once the player stops tapping, so
// these are roomy for a kid flicking through hats.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const WARDROBE_RATE_LIMITS = {
  wear: {
    perIp: { max: 600, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e signs up and grants from one IP
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type WardrobeAction = keyof typeof WARDROBE_RATE_LIMITS;
