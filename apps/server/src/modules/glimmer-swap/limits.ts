// Rate limits for the Glimmer swap (#523, tech spec §5). A swap is one
// transaction a kid taps by hand, a few a day; this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const GLIMMER_SWAP_RATE_LIMITS = {
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  swap: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess; the cap is 3 a day
  },
} as const satisfies RateLimitTable;
