// Rate limits for the trading post's Shop (#729, tech spec §5). The caps stop
// farming; this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const POST_SHOP_RATE_LIMITS = {
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  buy: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 10, windowMs: MINUTE_MS }, // TUNE: #729 plan §4
  },
} as const satisfies RateLimitTable;
