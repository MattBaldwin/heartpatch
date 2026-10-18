// Rate limits for trick-or-treat (#515, tech spec §5). A kid knocks on at most
// a few doors a day (once per home); this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const TRICK_OR_TREAT_RATE_LIMITS = {
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  visit: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess; one knock per patch-mate's home a day
  },
} as const satisfies RateLimitTable;
