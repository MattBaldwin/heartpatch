// Rate limits for gathering (tech spec §5). Each start or collect is one
// short transaction; a player has a handful of nodes, so these are roomy.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const GATHERING_RATE_LIMITS = {
  gather: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type GatheringAction = keyof typeof GATHERING_RATE_LIMITS;
