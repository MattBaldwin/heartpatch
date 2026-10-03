// Rate limits for the starter pick (tech spec §5). A player picks once per
// patch, so only a few tries are ever needed; the rest are double taps.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const STARTER_RATE_LIMITS = {
  pick: {
    perIp: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess; a family shares one IP
    perUser: { max: 15, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type StarterAction = keyof typeof STARTER_RATE_LIMITS;
