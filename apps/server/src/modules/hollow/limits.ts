// Rate limits for the Hollow Man's endpoints (tech spec §5). Rescues start a
// battle, so they match starting one; these only stop tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';
import { BATTLE_RATE_LIMITS } from '../battles/limits.js';

export const HOLLOW_RATE_LIMITS = {
  rescue: BATTLE_RATE_LIMITS.start,
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; e2e runs from one IP
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type HollowAction = keyof typeof HOLLOW_RATE_LIMITS;
