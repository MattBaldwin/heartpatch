// Rate limits for selling to the trading post (#601 PR 3, tech spec §5). A
// sale is one transaction a kid taps by hand after a confirm; the day's cap
// stops farming, so this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const POST_SELL_RATE_LIMITS = {
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  sell: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess; each sale is confirmed first
  },
} as const satisfies RateLimitTable;
