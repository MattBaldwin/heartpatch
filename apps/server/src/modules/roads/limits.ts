// Rate limits for road commands (Wild Isle #621, tech spec §5): each is one
// short transaction, like fences.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const ROADS_RATE_LIMITS = {
  road: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; laying a long road
  },
} as const satisfies RateLimitTable;

export type RoadsAction = keyof typeof ROADS_RATE_LIMITS;
