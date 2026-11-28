// Rate limits for line commands (Clockwork Isle #874, tech spec §5): each is one
// short transaction, like roads.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const LINES_RATE_LIMITS = {
  line: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; laying a long wire
  },
} as const satisfies RateLimitTable;

export type LinesAction = keyof typeof LINES_RATE_LIMITS;
