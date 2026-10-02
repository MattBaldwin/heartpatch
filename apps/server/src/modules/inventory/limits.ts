// Rate limits for the bag and crafting (tech spec §5). Dev grants are
// dev/test only but still limited, since e2e shares one IP.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const INVENTORY_RATE_LIMITS = {
  craft: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e signs up and grants from one IP
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type InventoryAction = keyof typeof INVENTORY_RATE_LIMITS;
