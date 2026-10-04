// Rate limits for milestones (tech spec §5). Reading is cheap and the client
// checks after play; marking seen and wearing a title are single taps.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const MILESTONES_RATE_LIMITS = {
  update: {
    perIp: { max: 600, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type MilestonesAction = keyof typeof MILESTONES_RATE_LIMITS;
