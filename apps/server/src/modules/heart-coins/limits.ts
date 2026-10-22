// Rate limits for Heart Coins (#601, tech spec §5). Reading the balance is
// cheap; the dev grant is for e2e and phone testing only.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const HEART_COINS_RATE_LIMITS = {
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e signs up and grants from one IP
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type HeartCoinsAction = keyof typeof HEART_COINS_RATE_LIMITS;
