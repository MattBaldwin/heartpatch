// Rate limits for gathering (tech spec §5). Each start or collect is one
// short transaction; a player has a handful of nodes, so these are roomy.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const GATHERING_RATE_LIMITS = {
  gather: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
} as const satisfies RateLimitTable;

export type GatheringAction = keyof typeof GATHERING_RATE_LIMITS;
