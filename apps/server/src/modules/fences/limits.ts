// Rate limits for fence commands (#203, tech spec §5): each is one short
// transaction, like building at home.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const FENCES_RATE_LIMITS = {
  fence: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; fencing a whole border
  },
} as const satisfies RateLimitTable;

export type FencesAction = keyof typeof FENCES_RATE_LIMITS;
