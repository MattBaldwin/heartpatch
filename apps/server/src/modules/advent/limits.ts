// Rate limits for advent commands (tech spec §5). One present a day plus one
// catch-up, so these only stop a runaway client.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const ADVENT_RATE_LIMITS = {
  claim: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess; double taps and retries
  },
  // Opening wrapped presents from the bag: a few in a row on Christmas morning.
  open: {
    perIp: { max: 240, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; about one a second
  },
} as const satisfies RateLimitTable;

export type AdventAction = keyof typeof ADVENT_RATE_LIMITS;
