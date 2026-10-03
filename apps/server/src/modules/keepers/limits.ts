// Rate limits for Keepers (tech spec §5). Only saving calls the server (the
// picker tries colours on the device), so a few saves a minute is plenty.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const KEEPER_RATE_LIMITS = {
  save: {
    perIp: { max: 120, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family shares one IP
    perUser: { max: 30, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type KeeperAction = keyof typeof KEEPER_RATE_LIMITS;
