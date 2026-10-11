// Rate limits for clearing land (tech spec §5). A clear is one short
// transaction and a player clears one tile at a time, so these are roomy.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const CLEARING_RATE_LIMITS = {
  clear: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
} as const satisfies RateLimitTable;

export type ClearingAction = keyof typeof CLEARING_RATE_LIMITS;
