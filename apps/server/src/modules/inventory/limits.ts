// Rate limits for the bag and crafting (tech spec §5). Dev grants are
// dev/test only but still limited, since e2e shares one IP.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const INVENTORY_RATE_LIMITS = {
  craft: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e signs up and grants from one IP
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type InventoryAction = keyof typeof INVENTORY_RATE_LIMITS;
