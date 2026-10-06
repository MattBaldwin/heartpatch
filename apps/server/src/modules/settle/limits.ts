// Rate limits for settling (tech spec §5): a map opening, a countdown ending,
// the Bag opening and the app coming back each ask once.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const SETTLE_RATE_LIMITS = {
  settle: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e and a family share one IP
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a phone flipping between apps
  },
} as const satisfies RateLimitTable;
