// Rate limits for home-base commands (tech spec §5). Each is one short
// transaction; a kid decorating their home taps a lot, so these are roomy.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const BUILDINGS_RATE_LIMITS = {
  build: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
} as const satisfies RateLimitTable;

export type BuildingsAction = keyof typeof BUILDINGS_RATE_LIMITS;
