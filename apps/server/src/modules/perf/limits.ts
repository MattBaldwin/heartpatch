// Rate limits for the on-device perf report (#501, tech spec §5). The client
// sends at most one a minute (a slow run of 5 s under 10 fps); two leaves
// room for a request that lands a moment early, and nothing more.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const PERF_RATE_LIMITS = {
  report: {
    perIp: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess; a family shares one IP
    perUser: { max: 2, windowMs: MINUTE_MS }, // TUNE: the client's once a minute, plus one
  },
} as const satisfies RateLimitTable;

export type PerfAction = keyof typeof PERF_RATE_LIMITS;
