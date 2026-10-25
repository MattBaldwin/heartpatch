// Rate limits for the weather's dev commands (Wild Isle #621, tech spec §5).
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const WEATHER_RATE_LIMITS = {
  dev: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; tests and screenshots
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type WeatherAction = keyof typeof WEATHER_RATE_LIMITS;
