// Rate limits for the Long Night's endpoints (#727, tech spec §5). The owner's
// weekday is a setting like friendly battles' switch; this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const LONG_NIGHT_RATE_LIMITS = {
  owner: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess, as friendly battles' switch
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
  // Juniper's Gap (#727d): a battle start, as wild battles' own.
  gap: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type LongNightAction = keyof typeof LONG_NIGHT_RATE_LIMITS;
