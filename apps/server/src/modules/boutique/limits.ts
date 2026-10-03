// Rate limits for the Boutique (tech spec §5). A purchase is a tap on a
// confirm sheet, so a kid never needs many a minute.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const BOUTIQUE_RATE_LIMITS = {
  buy: {
    perIp: { max: 200, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 40, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type BoutiqueAction = keyof typeof BOUTIQUE_RATE_LIMITS;
