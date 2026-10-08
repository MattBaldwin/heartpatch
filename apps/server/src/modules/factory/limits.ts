// Rate limits for the Crafting Factory (tech spec §5), like crafting's.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const FACTORY_RATE_LIMITS = {
  factory: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e and a family share one IP
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e signs up and grants from one IP
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;
