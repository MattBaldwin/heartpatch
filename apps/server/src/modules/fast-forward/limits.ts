// Rate limits for the dev fast-forward (#736, tech spec §5): owner playtests only.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const FAST_FORWARD_RATE_LIMITS = {
  dev: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 10, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type FastForwardAction = keyof typeof FAST_FORWARD_RATE_LIMITS;
