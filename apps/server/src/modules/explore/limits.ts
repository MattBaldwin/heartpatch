// Rate limits for exploring (tech spec §5). A search is one short
// transaction behind a few seconds of touch play, so these are roomy.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const EXPLORE_RATE_LIMITS = {
  explore: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; quick searches, with retries
  },
} as const satisfies RateLimitTable;
