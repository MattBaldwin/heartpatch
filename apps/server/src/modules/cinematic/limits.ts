// Rate limits for the opening cinematic (tech spec §5). The client marks it
// seen once at the end of a first viewing, so a few calls a minute is plenty.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const CINEMATIC_RATE_LIMITS = {
  seen: {
    perIp: { max: 120, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family shares one IP
    perUser: { max: 30, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type CinematicAction = keyof typeof CINEMATIC_RATE_LIMITS;
