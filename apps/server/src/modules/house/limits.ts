// Rate limits for house commands (tech spec §5). A build is a rare, big
// moment; these only stop a runaway client.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const HOUSE_RATE_LIMITS = {
  build: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess; retries included
  },
} as const satisfies RateLimitTable;

export type HouseAction = keyof typeof HOUSE_RATE_LIMITS;
