// Rate limits for squishy jobs (tech spec §5). Each command is one short
// transaction; a kid shuffling their squishies around taps a lot.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const JOBS_RATE_LIMITS = {
  jobs: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
} as const satisfies RateLimitTable;

export type JobsAction = keyof typeof JOBS_RATE_LIMITS;
