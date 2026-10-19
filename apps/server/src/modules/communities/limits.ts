// Rate limits for restoring and naming villages (tech spec §5). A piece is
// one short transaction behind a tap, so these are roomy.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const COMMUNITY_RATE_LIMITS = {
  communities: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; quick taps, with retries
  },
} as const satisfies RateLimitTable;
