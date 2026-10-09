// Rate limits for the Lorebook (tech spec §5). Reading is free; marking a page
// read is one call per page turn at most.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const LORE_RATE_LIMITS = {
  read: {
    perIp: { max: 600, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type LoreAction = keyof typeof LORE_RATE_LIMITS;
